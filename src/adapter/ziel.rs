//! Der Weg nach draußen für Adapter (LLH-2017, ADR-0076, Design-Doc „Weg nach draußen“).
//!
//! Ein Adapter erreicht das Netz nur über den [`AbrufKontext`]: jede URL besteht vor jeder Anfrage
//! den Zielschutz der Webhooks (`webhook::ziel::check_url`, IP-Literale umgehen den Resolver),
//! der Client folgt keiner Weiterleitung, nutzt keinen Proxy, nur `https` und den pinnenden
//! Resolver (`WebhookResolver`: Loopback, Link-Local und Multicast nie, LAN nur mit Ausnahme).
//! Antworten liest er nur gedeckelt (`http_begrenzt`).

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use age::secrecy::SecretString;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

use super::art::Fehlschlag;
use super::zustand::AdapterFehler;
use crate::ausgehend::{client_builder, Zweck};
use crate::http_begrenzt::{self, LeseFehler};
use crate::public_api::webhook::ziel::{check_url, fehler_art, WebhookResolver};
use crate::public_api::webhook::WebhookFehler;

/// Zeit für den Verbindungsaufbau.
pub const VERBINDUNG_ZEITLIMIT: Duration = Duration::from_secs(5);

/// Gesamtzeit einer Anfrage. Liegt unter `zulassung::REQUEST_BUDGET`, weil der Probelauf in einer
/// Anfrage der Verwaltung wartet.
pub const ZEITLIMIT: Duration = Duration::from_secs(20);

fn build_client(lan_erlaubt: bool) -> reqwest::Client {
    client_builder(Zweck::Adapter)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .connect_timeout(VERBINDUNG_ZEITLIMIT)
        .timeout(ZEITLIMIT)
        .dns_resolver(Arc::new(WebhookResolver { lan_erlaubt }))
        .build()
        .expect("Adapter-Client baubar")
}

/// Der Client mit oder ohne LAN-Ausnahme (je ein Prozess-Singleton).
fn client(lan_erlaubt: bool) -> &'static reqwest::Client {
    static OEFFENTLICH: OnceLock<reqwest::Client> = OnceLock::new();
    static MIT_LAN: OnceLock<reqwest::Client> = OnceLock::new();
    if lan_erlaubt {
        MIT_LAN.get_or_init(|| build_client(true))
    } else {
        OEFFENTLICH.get_or_init(|| build_client(false))
    }
}

/// Ordnet einen Status ein: `None` bei 2xx.
pub fn fehler_aus_status(status: u16) -> Option<AdapterFehler> {
    match status {
        200..=299 => None,
        300..=399 => Some(AdapterFehler::Weiterleitung),
        401 | 403 => Some(AdapterFehler::Abgelehnt),
        _ => Some(AdapterFehler::Status),
    }
}

fn von_webhook(f: WebhookFehler) -> AdapterFehler {
    match f {
        WebhookFehler::Status => AdapterFehler::Status,
        WebhookFehler::Weiterleitung => AdapterFehler::Weiterleitung,
        WebhookFehler::Zeitueberschreitung => AdapterFehler::Zeitueberschreitung,
        WebhookFehler::Verbindung => AdapterFehler::Verbindung,
        WebhookFehler::Tls => AdapterFehler::Tls,
        WebhookFehler::ZielIntern => AdapterFehler::ZielIntern,
        WebhookFehler::Dns => AdapterFehler::Dns,
        WebhookFehler::ZielUngueltig => AdapterFehler::ZielUngueltig,
    }
}

fn von_lesefehler(f: LeseFehler) -> AdapterFehler {
    match f {
        LeseFehler::ZuGross { .. } => AdapterFehler::ZuGross,
        LeseFehler::Json(_) => AdapterFehler::AntwortUngueltig,
        LeseFehler::Http(_) => AdapterFehler::Verbindung,
    }
}

/// Was eine Art beim Abruf sieht: ihre Einstellungen, ihre entschlüsselten Geheimnisse und den
/// Weg nach draußen. Kein Zugriff auf die Datenbank.
pub struct AbrufKontext<'a> {
    pub adapter_id: &'a str,
    pub org_id: i64,
    pub einstellungen: &'a Map<String, Value>,
    /// „Verbindung prüfen“: nichts übernehmen.
    pub is_probe: bool,
    lan_erlaubt: bool,
    geheimnisse: &'a HashMap<String, SecretString>,
}

impl<'a> AbrufKontext<'a> {
    pub fn new(
        adapter_id: &'a str,
        org_id: i64,
        einstellungen: &'a Map<String, Value>,
        geheimnisse: &'a HashMap<String, SecretString>,
        lan_erlaubt: bool,
        is_probe: bool,
    ) -> Self {
        AbrufKontext {
            adapter_id,
            org_id,
            einstellungen,
            is_probe,
            lan_erlaubt,
            geheimnisse,
        }
    }

    /// Ein Geheimnis der Art, entschlüsselt. Nicht loggen, nicht in Fehler schreiben.
    pub fn geheimnis(&self, name: &str) -> Option<&SecretString> {
        self.geheimnisse.get(name)
    }

    /// Ein Textfeld der Einstellungen.
    pub fn einstellung_text(&self, name: &str) -> Option<&str> {
        self.einstellungen.get(name).and_then(Value::as_str)
    }

    /// Eine Anfrage an `url`, nachdem sie den Zielschutz bestanden hat.
    pub fn request(
        &self,
        methode: reqwest::Method,
        url: &str,
    ) -> Result<reqwest::RequestBuilder, Fehlschlag> {
        let url = check_url(url, self.lan_erlaubt).map_err(|f| {
            Fehlschlag::new(match f {
                crate::public_api::webhook::ziel::ZielFehler::Intern
                | crate::public_api::webhook::ziel::ZielFehler::Localhost => {
                    AdapterFehler::ZielIntern
                }
                _ => AdapterFehler::ZielUngueltig,
            })
        })?;
        Ok(client(self.lan_erlaubt).request(methode, url))
    }

    pub fn get(&self, url: &str) -> Result<reqwest::RequestBuilder, Fehlschlag> {
        self.request(reqwest::Method::GET, url)
    }

    /// Sendet und ordnet ein: Netzfehler, 3xx, 401/403 und andere Status außerhalb von 2xx werden
    /// zum [`Fehlschlag`]. Der Rumpf einer Fehlantwort wird nicht gelesen.
    pub async fn send(&self, anfrage: reqwest::RequestBuilder) -> Result<reqwest::Response, Fehlschlag> {
        let antwort = anfrage
            .send()
            .await
            .map_err(|e| Fehlschlag::new(von_webhook(fehler_art(&e))))?;
        let status = antwort.status().as_u16();
        match fehler_aus_status(status) {
            None => Ok(antwort),
            Some(art) => Err(Fehlschlag {
                art,
                status: Some(status),
            }),
        }
    }

    /// Liest JSON mit Deckel (`http_begrenzt`).
    pub async fn read_json<T: DeserializeOwned>(
        &self,
        antwort: reqwest::Response,
        deckel: usize,
    ) -> Result<T, Fehlschlag> {
        http_begrenzt::lies_json_begrenzt(antwort, deckel)
            .await
            .map_err(|f| Fehlschlag::new(von_lesefehler(f)))
    }

    /// Liest Text mit Deckel (`http_begrenzt`).
    pub async fn read_text(
        &self,
        antwort: reqwest::Response,
        deckel: usize,
    ) -> Result<String, Fehlschlag> {
        http_begrenzt::lies_text_begrenzt(antwort, deckel)
            .await
            .map_err(|f| Fehlschlag::new(von_lesefehler(f)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_wird_eingeordnet() {
        assert_eq!(fehler_aus_status(200), None);
        assert_eq!(fehler_aus_status(204), None);
        assert_eq!(fehler_aus_status(301), Some(AdapterFehler::Weiterleitung));
        assert_eq!(fehler_aus_status(401), Some(AdapterFehler::Abgelehnt));
        assert_eq!(fehler_aus_status(403), Some(AdapterFehler::Abgelehnt));
        assert_eq!(fehler_aus_status(404), Some(AdapterFehler::Status));
        assert_eq!(fehler_aus_status(503), Some(AdapterFehler::Status));
    }

    #[test]
    fn ziel_wird_vor_der_anfrage_geprueft() {
        let leer = Map::new();
        let geheimnisse = HashMap::new();
        let k = AbrufKontext::new("a", 1, &leer, &geheimnisse, false, false);
        // IP-Literale umgehen den Resolver; der Zielschutz fängt sie vorher.
        let f = k.get("https://127.0.0.1/x").unwrap_err();
        assert_eq!(f.art, AdapterFehler::ZielIntern);
        assert_eq!(
            k.get("https://localhost/x").unwrap_err().art,
            AdapterFehler::ZielIntern
        );
        assert_eq!(
            k.get("https://10.0.0.1/x").unwrap_err().art,
            AdapterFehler::ZielIntern
        );
        assert_eq!(
            k.get("http://api.example.org/").unwrap_err().art,
            AdapterFehler::ZielUngueltig
        );
        assert!(k.get("https://api.example.org/").is_ok());

        let mit_lan = AbrufKontext::new("a", 1, &leer, &geheimnisse, true, false);
        assert!(mit_lan.get("https://10.0.0.1/x").is_ok());
        assert_eq!(
            mit_lan.get("https://127.0.0.1/x").unwrap_err().art,
            AdapterFehler::ZielIntern
        );
    }
}
