//! Der Weg nach draußen für Adapter (LLH-2017, ADR-0077, Design-Doc „Weg nach draußen“).
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
use reqwest::header::{
    HeaderMap, HeaderValue, ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH, LAST_MODIFIED,
};
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};

use super::art::Fehlschlag;
use super::zustand::AdapterFehler;
use crate::ausgehend::{client_builder, Zweck};
use crate::http_begrenzt::{self, LeseFehler};
use crate::karte_fremdebene::FremdebeneFehler;
use crate::public_api::webhook::ziel::{check_url, fehler_art, WebhookResolver, ZielFehler};
use crate::public_api::webhook::WebhookFehler;

/// Zeit für den Verbindungsaufbau.
pub const VERBINDUNG_ZEITLIMIT: Duration = Duration::from_secs(5);

/// Gesamtzeit einer Anfrage. Liegt unter `zulassung::REQUEST_BUDGET`, weil der Probelauf in einer
/// Anfrage der Verwaltung wartet.
pub const ZEITLIMIT: Duration = Duration::from_secs(20);

/// Die Schutzeinstellungen des Adapter-Clients, an einer Stelle: kein Proxy, keine
/// Weiterleitung, nur `https`, Zeitlimits, pinnender Resolver. Die Tests des echten Abrufs
/// (`ziel_fetch_tests.rs`) bauen darauf auf.
fn protected_client_builder(lan_erlaubt: bool) -> reqwest::ClientBuilder {
    client_builder(Zweck::Adapter)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .connect_timeout(VERBINDUNG_ZEITLIMIT)
        .timeout(ZEITLIMIT)
        .dns_resolver(Arc::new(WebhookResolver { lan_erlaubt }))
}

fn build_client(lan_erlaubt: bool) -> reqwest::Client {
    protected_client_builder(lan_erlaubt)
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

/// Der Client für `http` im LAN ([`check_adapter_url`] hat das Ziel vorher geprüft).
fn client_http_lan() -> &'static reqwest::Client {
    static HTTP_LAN: OnceLock<reqwest::Client> = OnceLock::new();
    HTTP_LAN.get_or_init(|| {
        protected_client_builder(true)
            .https_only(false)
            .build()
            .expect("Adapter-Client baubar")
    })
}

/// Zielschutz einer Adapter-URL: [`check_url`], dazu `http` nur, wenn die Art es erlaubt
/// (`AdapterArt::http_im_lan`), die LAN-Ausnahme gesetzt ist und der Host ein IP-Literal in einem
/// privaten Netz ist (`ausgehend::zieladresse::klasse`). Ein Hostname geht nie per `http`: er
/// könnte auf eine öffentliche Adresse zeigen (`src/AGENTS.md`, „Adapter“, ADR-0105).
pub fn check_adapter_url(
    roh: &str,
    lan_erlaubt: bool,
    http_im_lan: bool,
) -> Result<reqwest::Url, ZielFehler> {
    let url = reqwest::Url::parse(roh.trim()).map_err(|_| ZielFehler::Unlesbar)?;
    if url.scheme() != "http" {
        return check_url(roh, lan_erlaubt);
    }
    if !(http_im_lan && lan_erlaubt) {
        return Err(ZielFehler::NichtHttps);
    }
    let ip = url
        .host_str()
        .map(|h| h.trim_start_matches('[').trim_end_matches(']'))
        .and_then(|h| h.parse::<std::net::IpAddr>().ok())
        .ok_or(ZielFehler::NichtHttps)?;
    if crate::ausgehend::zieladresse::klasse(&ip)
        != crate::ausgehend::zieladresse::Adressklasse::Privat
    {
        return Err(ZielFehler::Intern);
    }
    // Übrige Regeln (Anmeldedaten, Anker, Host) wie bei `https`.
    let mut als_https = url.clone();
    als_https
        .set_scheme("https")
        .map_err(|_| ZielFehler::Unlesbar)?;
    check_url(als_https.as_str(), lan_erlaubt)?;
    Ok(url)
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
    http_im_lan: bool,
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
            http_im_lan: false,
            geheimnisse,
        }
    }

    /// `http` zu privaten IP-Literalen erlauben ([`check_adapter_url`]); setzt der Rahmen aus
    /// `AdapterArt::http_im_lan`.
    pub fn with_http_im_lan(mut self, http_im_lan: bool) -> Self {
        self.http_im_lan = http_im_lan;
        self
    }

    /// Ein Geheimnis der Art, entschlüsselt. Nicht loggen, nicht in Fehler schreiben.
    pub fn geheimnis(&self, name: &str) -> Option<&SecretString> {
        self.geheimnisse.get(name)
    }

    /// Ob der Adapter die LAN-Ausnahme hat (für Arten, die ihr Ziel selbst auflösen, etwa SMTP).
    pub fn lan_erlaubt(&self) -> bool {
        self.lan_erlaubt
    }

    /// Alle Geheimnisse der Art, entschlüsselt. Nicht loggen, nicht in Fehler schreiben.
    pub fn geheimnisse(&self) -> &HashMap<String, SecretString> {
        self.geheimnisse
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
        let url = check_adapter_url(url, self.lan_erlaubt, self.http_im_lan).map_err(|f| {
            Fehlschlag::new(match f {
                crate::public_api::webhook::ziel::ZielFehler::Intern
                | crate::public_api::webhook::ziel::ZielFehler::Localhost => {
                    AdapterFehler::ZielIntern
                }
                _ => AdapterFehler::ZielUngueltig,
            })
        })?;
        let client = if url.scheme() == "http" {
            client_http_lan()
        } else {
            client(self.lan_erlaubt)
        };
        Ok(client.request(methode, url))
    }

    pub fn get(&self, url: &str) -> Result<reqwest::RequestBuilder, Fehlschlag> {
        self.request(reqwest::Method::GET, url)
    }

    /// Sendet und ordnet ein: Netzfehler, 3xx, 401/403 und andere Status außerhalb von 2xx werden
    /// zum [`Fehlschlag`]. Der Rumpf einer Fehlantwort wird nicht gelesen.
    pub async fn send(
        &self,
        anfrage: reqwest::RequestBuilder,
    ) -> Result<reqwest::Response, Fehlschlag> {
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

    /// Liest Bytes mit Deckel (`http_begrenzt`).
    pub async fn read_bytes(
        &self,
        antwort: reqwest::Response,
        deckel: usize,
    ) -> Result<axum::body::Bytes, Fehlschlag> {
        http_begrenzt::lies_begrenzt(antwort, deckel)
            .await
            .map(axum::body::Bytes::from)
            .map_err(|f| Fehlschlag::new(von_lesefehler(f)))
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

/// Antwort eines bedingten Abrufs ([`fetch_bedingt`]): 200 mit Rumpf oder 304 ohne.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BedingteAntwort {
    pub status: u16,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    /// `None` bei 304.
    pub body: Option<Vec<u8>>,
}

/// Ordnet den Status eines bedingten Abrufs ein: `None` bei 2xx und 304.
pub fn fremdebene_fehler_aus_status(status: u16) -> Option<FremdebeneFehler> {
    match status {
        200..=299 | 304 => None,
        300..=399 => Some(FremdebeneFehler::Weiterleitung),
        401 | 403 => Some(FremdebeneFehler::Abgelehnt),
        _ => Some(FremdebeneFehler::Status),
    }
}

/// Ordnet eine abgelehnte Ziel-URL ein: ein internes Ziel ist `ziel_intern`, jede andere (etwa
/// `http://`) `abgelehnt`.
pub fn fremdebene_fehler_aus_ziel(f: ZielFehler) -> FremdebeneFehler {
    match f {
        ZielFehler::Intern | ZielFehler::Localhost => FremdebeneFehler::ZielIntern,
        _ => FremdebeneFehler::Abgelehnt,
    }
}

fn fremdebene_fehler_aus_webhook(f: WebhookFehler) -> FremdebeneFehler {
    match f {
        WebhookFehler::Zeitueberschreitung => FremdebeneFehler::Zeitlimit,
        WebhookFehler::ZielIntern => FremdebeneFehler::ZielIntern,
        WebhookFehler::Weiterleitung => FremdebeneFehler::Weiterleitung,
        WebhookFehler::Status => FremdebeneFehler::Status,
        WebhookFehler::ZielUngueltig => FremdebeneFehler::Abgelehnt,
        WebhookFehler::Verbindung | WebhookFehler::Tls | WebhookFehler::Dns => {
            FremdebeneFehler::NichtErreichbar
        }
    }
}

/// Die Köpfe eines bedingten Abrufs aus den Validatoren der letzten Antwort. Ein Wert, der kein
/// gültiger Kopf ist, fällt weg (dann kommt eben 200).
pub fn bedingte_koepfe(etag: Option<&str>, last_modified: Option<&str>) -> HeaderMap {
    let mut koepfe = HeaderMap::new();
    if let Some(wert) = etag.and_then(|e| HeaderValue::from_str(e).ok()) {
        koepfe.insert(IF_NONE_MATCH, wert);
    }
    if let Some(wert) = last_modified.and_then(|l| HeaderValue::from_str(l).ok()) {
        koepfe.insert(IF_MODIFIED_SINCE, wert);
    }
    koepfe
}

fn kopf_text(antwort: &reqwest::Response, name: reqwest::header::HeaderName) -> Option<String> {
    antwort
        .headers()
        .get(name)
        .and_then(|w| w.to_str().ok())
        .map(str::to_string)
}

/// Bedingter Abruf einer Fremdebene (LLH-2100) über denselben Weg wie die Adapter: Zielschutz
/// (`check_url`), der Client ohne Proxy und Weiterleitung, nur `https`, pinnender Resolver, Rumpf
/// gedeckelt (`deckel`). Fehler tragen nur den Code, nie die URL.
pub async fn fetch_bedingt(
    url: &str,
    lan_erlaubt: bool,
    deckel: usize,
    etag: Option<&str>,
    last_modified: Option<&str>,
) -> Result<BedingteAntwort, FremdebeneFehler> {
    fetch_bedingt_via(
        client(lan_erlaubt),
        url,
        lan_erlaubt,
        deckel,
        etag,
        last_modified,
    )
    .await
}

/// [`fetch_bedingt`] über einen gegebenen Client; die Naht für die Tests gegen einen echten
/// Server. Bleibt crate-intern: ein Client ohne pinnenden Resolver umginge den Zielschutz.
async fn fetch_bedingt_via(
    client: &reqwest::Client,
    url: &str,
    lan_erlaubt: bool,
    deckel: usize,
    etag: Option<&str>,
    last_modified: Option<&str>,
) -> Result<BedingteAntwort, FremdebeneFehler> {
    let ziel = check_url(url, lan_erlaubt).map_err(fremdebene_fehler_aus_ziel)?;
    let antwort = client
        .get(ziel)
        .headers(bedingte_koepfe(etag, last_modified))
        .send()
        .await
        .map_err(|e| fremdebene_fehler_aus_webhook(fehler_art(&e)))?;
    let status = antwort.status().as_u16();
    if let Some(f) = fremdebene_fehler_aus_status(status) {
        return Err(f);
    }
    let etag = kopf_text(&antwort, ETAG);
    let last_modified = kopf_text(&antwort, LAST_MODIFIED);
    let body = if status == 304 {
        None
    } else {
        Some(
            http_begrenzt::lies_begrenzt(antwort, deckel)
                .await
                .map_err(|f| match f {
                    LeseFehler::ZuGross { .. } => FremdebeneFehler::ZuGross,
                    LeseFehler::Json(_) | LeseFehler::Http(_) => FremdebeneFehler::NichtErreichbar,
                })?,
        )
    };
    Ok(BedingteAntwort {
        status,
        etag,
        last_modified,
        body,
    })
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

    #[test]
    fn http_nur_zu_privatem_ip_literal_mit_beiden_flags() {
        let m3u8 = "http://10.0.0.5:8888/a/index.m3u8";
        assert!(check_adapter_url(m3u8, true, true).is_ok());
        assert_eq!(
            check_adapter_url(m3u8, true, false),
            Err(ZielFehler::NichtHttps)
        );
        assert!(check_adapter_url(m3u8, false, true).is_err());
        for ok in [
            "http://100.64.1.2/x",
            "http://[fd00::1]/x",
            "http://192.168.1.9/x",
        ] {
            assert!(check_adapter_url(ok, true, true).is_ok(), "{ok}");
        }
        for name in [
            "http://mediamtx.lan/x",
            "http://8.8.8.8/x",
            "http://localhost/x",
        ] {
            assert!(check_adapter_url(name, true, true).is_err(), "{name}");
        }
        for gesperrt in [
            "http://127.0.0.1/x",
            "http://169.254.1.1/x",
            "http://[::1]/x",
        ] {
            assert!(
                check_adapter_url(gesperrt, true, true).is_err(),
                "{gesperrt}"
            );
        }
        assert_eq!(
            check_adapter_url("http://u:p@10.0.0.5/x", true, true),
            Err(ZielFehler::Anmeldedaten)
        );
        assert!(check_adapter_url("http://10.0.0.5/x#a", true, true).is_err());
        assert!(check_adapter_url("ftp://10.0.0.5/x", true, true).is_err());
        assert!(check_adapter_url("https://beispiel.de/x", false, false).is_ok());
    }

    #[test]
    fn kontext_mit_http_im_lan() {
        let leer = Map::new();
        let geheimnisse = HashMap::new();
        let k = AbrufKontext::new("a", 1, &leer, &geheimnisse, true, false).with_http_im_lan(true);
        assert!(k.get("http://10.0.0.5:8888/d/seg1.mp4").is_ok());
        assert!(k.get("http://mediamtx.lan/x").is_err());
        let ohne = AbrufKontext::new("a", 1, &leer, &geheimnisse, true, false);
        assert!(ohne.get("http://10.0.0.5:8888/d/seg1.mp4").is_err());
    }

    #[test]
    fn fremdebene_status_wird_eingeordnet() {
        assert_eq!(fremdebene_fehler_aus_status(200), None);
        assert_eq!(fremdebene_fehler_aus_status(304), None);
        assert_eq!(
            fremdebene_fehler_aus_status(302),
            Some(FremdebeneFehler::Weiterleitung)
        );
        assert_eq!(
            fremdebene_fehler_aus_status(301),
            Some(FremdebeneFehler::Weiterleitung)
        );
        assert_eq!(
            fremdebene_fehler_aus_status(403),
            Some(FremdebeneFehler::Abgelehnt)
        );
        assert_eq!(
            fremdebene_fehler_aus_status(404),
            Some(FremdebeneFehler::Status)
        );
        assert_eq!(
            fremdebene_fehler_aus_status(500),
            Some(FremdebeneFehler::Status)
        );
    }

    #[test]
    fn bedingte_koepfe_aus_den_validatoren() {
        let k = bedingte_koepfe(Some("\"v1\""), Some("Wed, 21 Oct 2026 07:28:00 GMT"));
        assert_eq!(k.get(IF_NONE_MATCH).unwrap(), "\"v1\"");
        assert_eq!(
            k.get(IF_MODIFIED_SINCE).unwrap(),
            "Wed, 21 Oct 2026 07:28:00 GMT"
        );
        assert!(bedingte_koepfe(None, None).is_empty());
        // Ein Wert, der kein Kopf sein kann, fällt weg.
        assert!(bedingte_koepfe(Some("a\nb"), None).is_empty());
    }

    /// Der Zielschutz greift vor jeder Anfrage: weder `http` noch ein internes IP-Literal
    /// bekommen eine Verbindung (der Lauscher sieht keine).
    #[tokio::test]
    async fn fetch_bedingt_prueft_das_ziel_vorher() {
        let lauscher = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = lauscher.local_addr().unwrap().port();
        let deckel = 1024;
        let faelle = [
            (
                format!("http://127.0.0.1:{port}/x"),
                true,
                FremdebeneFehler::Abgelehnt,
            ),
            (
                "http://geo.example.org/x".to_string(),
                false,
                FremdebeneFehler::Abgelehnt,
            ),
            (
                format!("https://127.0.0.1:{port}/x"),
                true,
                FremdebeneFehler::ZielIntern,
            ),
            (
                format!("https://localhost:{port}/x"),
                true,
                FremdebeneFehler::ZielIntern,
            ),
            (
                "https://10.0.0.1/x".to_string(),
                false,
                FremdebeneFehler::ZielIntern,
            ),
            (
                "https://192.168.1.5/x".to_string(),
                false,
                FremdebeneFehler::ZielIntern,
            ),
            ("kein url".to_string(), false, FremdebeneFehler::Abgelehnt),
        ];
        for (url, lan, erwartet) in faelle {
            assert_eq!(
                fetch_bedingt(&url, lan, deckel, Some("\"v1\""), None).await,
                Err(erwartet),
                "{url}"
            );
        }
        let angenommen =
            tokio::time::timeout(std::time::Duration::from_millis(200), lauscher.accept()).await;
        assert!(angenommen.is_err(), "keine Verbindung erwartet");
    }

    #[test]
    fn fremdebene_zielfehler_und_netzfehler() {
        assert_eq!(
            fremdebene_fehler_aus_ziel(ZielFehler::NichtHttps),
            FremdebeneFehler::Abgelehnt
        );
        assert_eq!(
            fremdebene_fehler_aus_ziel(ZielFehler::Localhost),
            FremdebeneFehler::ZielIntern
        );
        assert_eq!(
            fremdebene_fehler_aus_webhook(WebhookFehler::Zeitueberschreitung),
            FremdebeneFehler::Zeitlimit
        );
        assert_eq!(
            fremdebene_fehler_aus_webhook(WebhookFehler::Dns),
            FremdebeneFehler::NichtErreichbar
        );
        assert_eq!(
            fremdebene_fehler_aus_webhook(WebhookFehler::ZielIntern),
            FremdebeneFehler::ZielIntern
        );
    }
}

#[cfg(test)]
#[path = "ziel_fetch_tests.rs"]
mod fetch_tests;
