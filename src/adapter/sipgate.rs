//! Der Weg zu sipgate für den Fax-Kanal (LLH-2095, Design-Doc
//! `docs/superpowers/specs/2026-11-25-atnsssv3-ausgang-fax-pdf-design.md`, Abschnitte 2 bis 5).
//!
//! REST-API `https://api.sipgate.com/v2` mit Basic-Auth aus Token-ID und Personal Access Token
//! (Scopes `sessions:fax:write`, `history:read`): `POST /sessions/fax` übergibt ein PDF und
//! liefert eine Session-ID, `GET /history/{id}` den Stand (`faxStatusType`), `GET
//! /authorization/userinfo` und `GET /{userId}/faxlines` prüfen Zugang und Faxline. Feste Ziele,
//! ohne Weiterleitung, über den Zielschutz des Adapter-Rahmens. Nie Token, PDF oder Antworttext
//! in Log oder Fehler.

use std::sync::{Arc, OnceLock};
use std::time::Duration;

use age::secrecy::{ExposeSecret, SecretString};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};

use super::zustand::AdapterFehler;
use crate::ausgehend::{client_builder, Zweck};
use crate::public_api::webhook::ziel::{fehler_art, WebhookResolver};
use crate::public_api::webhook::WebhookFehler;

/// Basis der REST-API.
pub const API: &str = "https://api.sipgate.com/v2";

/// Gesamtzeit einer Übergabe: ein PDF bis 10 MiB (Base64 rund 14 MB) über eine schmale Leitung.
const SENDEN_ZEITLIMIT: Duration = Duration::from_secs(120);
/// Gesamtzeit einer Abfrage oder Prüfung.
const ABFRAGE_ZEITLIMIT: Duration = Duration::from_secs(20);
/// Deckel für jede Antwort (JSON, klein).
const ANTWORT_MAX: usize = 64 * 1024;

/// Fehler eines Aufrufs. `Ungewiss`: die Verbindung brach ab, nachdem die Anfrage hinaus war;
/// ob sipgate das Fax angenommen hat, ist offen (nie selbst wiederholen).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SipgateFehler {
    /// Antwort mit Status außerhalb von 2xx.
    Status(u16),
    /// Keine Verbindung zustande gekommen (vor dem Senden).
    Verbindung,
    Dns,
    Tls,
    /// Der Zielschutz hat die Adresse abgelehnt.
    ZielIntern,
    Ungewiss,
    /// 2xx, aber die Antwort war nicht lesbar.
    Antwort,
    /// Die Faxline der Anbindung gibt es im Konto nicht oder sie darf nicht senden.
    FaxlineUnbekannt,
}

impl SipgateFehler {
    /// Der HTTP-Status, falls es einen gab.
    pub fn status(&self) -> Option<u16> {
        match self {
            SipgateFehler::Status(s) => Some(*s),
            _ => None,
        }
    }

    /// Einordnung für den Zustand der Anbindung.
    pub fn adapter_fehler(&self) -> AdapterFehler {
        match self {
            SipgateFehler::Status(s) => {
                super::ziel::fehler_aus_status(*s).unwrap_or(AdapterFehler::Status)
            }
            SipgateFehler::Verbindung | SipgateFehler::Ungewiss => AdapterFehler::Verbindung,
            SipgateFehler::Dns => AdapterFehler::Dns,
            SipgateFehler::Tls => AdapterFehler::Tls,
            SipgateFehler::ZielIntern => AdapterFehler::ZielIntern,
            SipgateFehler::Antwort => AdapterFehler::AntwortUngueltig,
            SipgateFehler::FaxlineUnbekannt => AdapterFehler::EinstellungUngueltig,
        }
    }
}

/// Zugang aus der Anbindung: Token-ID (Feld) und Token (Geheimnis). Lebt nur für einen Aufruf.
pub struct SipgateZugang<'a> {
    pub token_id: &'a str,
    pub token: &'a SecretString,
    pub lan_erlaubt: bool,
}

/// Ein Fax: von welcher Faxline an welche Nummer (E.164), welche Datei.
pub struct FaxAuftrag<'a> {
    pub faxline_id: &'a str,
    pub empfaenger: &'a str,
    pub dateiname: &'a str,
    pub pdf: &'a [u8],
}

/// Stand eines übergebenen Faxes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FaxStatus {
    /// `PENDING`, `SENDING` oder `SCHEDULED`: noch kein Endstand.
    Laeuft,
    /// `SENT`: zugestellt.
    Gesendet,
    /// `FAILED`: nicht zugestellt.
    Gescheitert,
}

/// Liest `faxStatusType` der History.
pub fn parse_fax_status(s: &str) -> Option<FaxStatus> {
    match s {
        "PENDING" | "SENDING" | "SCHEDULED" => Some(FaxStatus::Laeuft),
        "SENT" => Some(FaxStatus::Gesendet),
        "FAILED" => Some(FaxStatus::Gescheitert),
        _ => None,
    }
}

/// Körper von `POST /sessions/fax`.
pub fn fax_body(a: &FaxAuftrag<'_>) -> Value {
    json!({
        "faxlineId": a.faxline_id,
        "recipient": a.empfaenger,
        "filename": a.dateiname,
        "base64Content": base64::engine::general_purpose::STANDARD.encode(a.pdf),
    })
}

fn build_client(lan_erlaubt: bool, zeitlimit: Duration) -> reqwest::Client {
    client_builder(Zweck::Adapter)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .https_only(true)
        .connect_timeout(super::ziel::VERBINDUNG_ZEITLIMIT)
        .timeout(zeitlimit)
        .dns_resolver(Arc::new(WebhookResolver { lan_erlaubt }))
        .build()
        .expect("sipgate-Client baubar")
}

fn client(lan_erlaubt: bool, senden: bool) -> &'static reqwest::Client {
    static C: [OnceLock<reqwest::Client>; 4] = [
        OnceLock::new(),
        OnceLock::new(),
        OnceLock::new(),
        OnceLock::new(),
    ];
    let i = usize::from(lan_erlaubt) * 2 + usize::from(senden);
    let zeit = if senden {
        SENDEN_ZEITLIMIT
    } else {
        ABFRAGE_ZEITLIMIT
    };
    C[i].get_or_init(|| build_client(lan_erlaubt, zeit))
}

/// Ordnet einen Fehler von reqwest ein. Beim Senden zählt nur ein Fehler **vor** dem
/// Verbindungsaufbau als wiederholbar; alles danach ist `Ungewiss`.
fn von_reqwest(e: &reqwest::Error, senden: bool) -> SipgateFehler {
    match fehler_art(e) {
        WebhookFehler::ZielIntern => SipgateFehler::ZielIntern,
        WebhookFehler::Tls => SipgateFehler::Tls,
        WebhookFehler::Dns => SipgateFehler::Dns,
        _ if senden && !e.is_connect() => SipgateFehler::Ungewiss,
        _ => SipgateFehler::Verbindung,
    }
}

async fn json_lesen<T: serde::de::DeserializeOwned>(
    antwort: reqwest::Response,
) -> Result<T, SipgateFehler> {
    crate::http_begrenzt::lies_json_begrenzt(antwort, ANTWORT_MAX)
        .await
        .map_err(|_| SipgateFehler::Antwort)
}

async fn senden_an(
    z: &SipgateZugang<'_>,
    anfrage: reqwest::RequestBuilder,
    senden: bool,
) -> Result<reqwest::Response, SipgateFehler> {
    let antwort = anfrage
        .basic_auth(z.token_id, Some(z.token.expose_secret()))
        .send()
        .await
        .map_err(|e| von_reqwest(&e, senden))?;
    let status = antwort.status().as_u16();
    if (200..300).contains(&status) {
        Ok(antwort)
    } else {
        Err(SipgateFehler::Status(status))
    }
}

/// Übergibt ein Fax. Liefert die Session-ID.
pub async fn senden(z: &SipgateZugang<'_>, a: &FaxAuftrag<'_>) -> Result<String, SipgateFehler> {
    #[derive(Deserialize)]
    struct Antwort {
        #[serde(rename = "sessionId")]
        session_id: String,
    }
    let anfrage = client(z.lan_erlaubt, true)
        .post(format!("{API}/sessions/fax"))
        .json(&fax_body(a));
    let antwort = senden_an(z, anfrage, true).await?;
    // Angenommen ist es jetzt; eine unlesbare Antwort lässt offen, unter welcher Session.
    let a: Antwort = json_lesen(antwort)
        .await
        .map_err(|_| SipgateFehler::Ungewiss)?;
    let id = a.session_id.trim();
    if id.is_empty() || id.len() > 200 {
        return Err(SipgateFehler::Ungewiss);
    }
    Ok(id.to_string())
}

/// Fragt den Stand einer Session ab.
pub async fn status(z: &SipgateZugang<'_>, session: &str) -> Result<FaxStatus, SipgateFehler> {
    #[derive(Deserialize)]
    struct Eintrag {
        #[serde(rename = "faxStatusType")]
        fax_status_type: Option<String>,
    }
    let segment: String = session
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let anfrage = client(z.lan_erlaubt, false).get(format!("{API}/history/{segment}"));
    let e: Eintrag = json_lesen(senden_an(z, anfrage, false).await?).await?;
    e.fax_status_type
        .as_deref()
        .and_then(parse_fax_status)
        .ok_or(SipgateFehler::Antwort)
}

/// Prüft Token und Faxline: die Faxline muss im Konto stehen und senden dürfen.
pub async fn pruefe(z: &SipgateZugang<'_>, faxline_id: &str) -> Result<(), SipgateFehler> {
    #[derive(Deserialize)]
    struct Nutzer {
        sub: String,
    }
    #[derive(Deserialize)]
    struct Leitung {
        id: String,
        #[serde(rename = "canSend", default)]
        can_send: bool,
    }
    #[derive(Deserialize)]
    struct Leitungen {
        items: Vec<Leitung>,
    }
    let c = client(z.lan_erlaubt, false);
    let n: Nutzer =
        json_lesen(senden_an(z, c.get(format!("{API}/authorization/userinfo")), false).await?)
            .await?;
    let sub: String = n.sub.chars().filter(char::is_ascii_alphanumeric).collect();
    let l: Leitungen =
        json_lesen(senden_an(z, c.get(format!("{API}/{sub}/faxlines")), false).await?).await?;
    if l.items.iter().any(|f| f.id == faxline_id && f.can_send) {
        Ok(())
    } else {
        Err(SipgateFehler::FaxlineUnbekannt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fax_status_werte_werden_eingeordnet() {
        assert_eq!(parse_fax_status("PENDING"), Some(FaxStatus::Laeuft));
        assert_eq!(parse_fax_status("SENDING"), Some(FaxStatus::Laeuft));
        assert_eq!(parse_fax_status("SCHEDULED"), Some(FaxStatus::Laeuft));
        assert_eq!(parse_fax_status("SENT"), Some(FaxStatus::Gesendet));
        assert_eq!(parse_fax_status("FAILED"), Some(FaxStatus::Gescheitert));
        assert_eq!(parse_fax_status("x"), None);
    }

    #[test]
    fn der_fax_koerper_traegt_die_vier_felder_und_das_pdf_als_base64() {
        let b = fax_body(&FaxAuftrag {
            faxline_id: "f0",
            empfaenger: "+49511123456",
            dateiname: "lagebericht-3.pdf",
            pdf: b"%PDF-1.7",
        });
        assert_eq!(b["faxlineId"], "f0");
        assert_eq!(b["recipient"], "+49511123456");
        assert_eq!(b["filename"], "lagebericht-3.pdf");
        assert_eq!(b["base64Content"], "JVBERi0xLjc=");
        assert_eq!(b.as_object().unwrap().len(), 4);
    }

    #[test]
    fn fehler_werden_fuer_die_anbindung_eingeordnet() {
        assert_eq!(
            SipgateFehler::Status(401).adapter_fehler(),
            AdapterFehler::Abgelehnt
        );
        assert_eq!(
            SipgateFehler::Status(402).adapter_fehler(),
            AdapterFehler::Status
        );
        assert_eq!(SipgateFehler::Status(402).status(), Some(402));
        assert_eq!(
            SipgateFehler::FaxlineUnbekannt.adapter_fehler(),
            AdapterFehler::EinstellungUngueltig
        );
    }
}
