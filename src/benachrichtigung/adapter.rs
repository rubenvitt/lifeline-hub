//! Benachrichtigungen am Ort Adapter (LLH-2026, Design-Doc
//! `docs/superpowers/specs/2026-11-22-k5fdiw6n-adapter-stoerung-melden-design.md`): die Störung
//! einer Anbindung erreicht die System-Admins der Org des Adapters, ohne Einsatz.
//!
//! Hier und nur hier stehen Empfänger, Leserecht und Text dieses Orts. Gemeldet wird weiter über
//! [`super::melden`] mit [`super::Anlass::adapter`], erledigt über [`super::erledigen_adapter`].
//! Die Detailzeile liest Org-Stammdaten des Adapters ([`DETAIL_ADAPTER_SPALTEN`]), nie seine
//! Einstellungen oder Geheimnisse; die Schwärzung kennt nur Einsatzdaten und gilt hier nicht.

use super::aufloesung::{abgeschaltet_fuer, org_nutzer, Aufgeloest};
use super::text::{titel, Text};
use super::{Adressat, Anlass, BenachrichtigungArt, BenachrichtigungStufe};
use crate::adapter::zustand::AdapterFehler;
use crate::auth::Benutzer;
use crate::error::AppError;
use sqlx::SqlitePool;
use std::collections::BTreeSet;

/// Was die Detailzeile aus der Adapterzeile liest (Guard `detail_adapter_liest_nur_adapterspalten`).
pub const DETAIL_ADAPTER_SPALTEN: &[(&str, &str)] = &[
    ("adapter", "name"),
    ("adapter", "angehalten_grund"),
    ("adapter", "letzter_fehler_art"),
    ("adapter", "letzter_fehler_status"),
];

/// Das SQL der Detailzeile, gebaut aus [`DETAIL_ADAPTER_SPALTEN`] in deren Reihenfolge: so liest
/// es nichts, was der Guard nicht kennt.
pub fn detail_sql() -> String {
    let spalten: Vec<&str> = DETAIL_ADAPTER_SPALTEN.iter().map(|(_, s)| *s).collect();
    format!("SELECT {} FROM adapter WHERE id = ?", spalten.join(", "))
}

/// Ob `benutzer` die Störungen eines Adapters der Org `org_id` bekommt und lesen darf: aktiver
/// System-Admin dieser Org. Nur er kann den Adapter ändern (`routes::adapter`).
fn ist_zustaendig(benutzer: &Benutzer, org_id: i64) -> bool {
    benutzer.aktiv && benutzer.ist_admin() && benutzer.org_id == org_id
}

/// Die Empfänger einer Störungsmeldung: die aktiven System-Admins der Org ohne Gerätekonten, ohne
/// den Auslöser. Wer die Art abgeschaltet hat, bekommt sie still. Andere Adressaten als
/// [`Adressat::OrgAdmins`] erreichen hier niemanden.
pub async fn empfaenger(
    pool: &SqlitePool,
    org_id: i64,
    anlass: &Anlass,
) -> Result<Aufgeloest, AppError> {
    let gemeint = anlass.adressaten.contains(&Adressat::OrgAdmins);
    let kandidaten: Vec<i64> = if gemeint {
        org_nutzer(pool, org_id)
            .await?
            .into_iter()
            .filter(|b| ist_zustaendig(b, org_id) && Some(b.id) != anlass.ausloeser)
            .map(|b| b.id)
            .collect()
    } else {
        Vec::new()
    };
    let abgeschaltet =
        if anlass.art.stufe() == BenachrichtigungStufe::Hinweis && !kandidaten.is_empty() {
            abgeschaltet_fuer(pool, &kandidaten, anlass.art).await?
        } else {
            BTreeSet::new()
        };
    let (still_ids, benutzer_ids) = kandidaten
        .into_iter()
        .partition(|id| abgeschaltet.contains(id));
    Ok(Aufgeloest {
        org_id,
        benutzer_ids,
        still_ids,
    })
}

/// Die Org eines Adapters; `None`, wenn es ihn nicht (mehr) gibt.
pub async fn org_von(pool: &SqlitePool, adapter_id: &str) -> Result<Option<i64>, AppError> {
    Ok(
        sqlx::query_scalar("SELECT org_id FROM adapter WHERE id = ?")
            .bind(adapter_id)
            .fetch_optional(pool)
            .await?,
    )
}

/// Ob `benutzer` eine Meldung zu diesem Adapter (noch) lesen darf: der Adapter besteht, und er
/// ist weiterhin System-Admin seiner Org. Sonst ist sie für ihn 404.
pub async fn darf_lesen(
    pool: &SqlitePool,
    benutzer: &Benutzer,
    adapter_id: &str,
) -> Result<bool, AppError> {
    Ok(org_von(pool, adapter_id)
        .await?
        .is_some_and(|org_id| ist_zustaendig(benutzer, org_id)))
}

/// Klartext eines Fehlercodes, gleichlautend mit der Seite „Anbindungen“
/// (`frontend/src/api/adapter.ts`, `adapterFehlerText`), mit HTTP-Status, falls das Ziel antwortete.
pub fn fehler_text(fehler: AdapterFehler, status: Option<i64>) -> String {
    use AdapterFehler::*;
    let text = match fehler {
        Status => "Ziel antwortete mit Fehler",
        Abgelehnt => "Zugang abgelehnt",
        Weiterleitung => "Ziel wollte weiterleiten",
        Zeitueberschreitung => "Keine Antwort in 20 s",
        Verbindung => "Keine Verbindung zum Ziel",
        Tls => "Zertifikat des Ziels nicht anerkannt",
        ZielIntern => "Ziel liegt in einem gesperrten Netz",
        Dns => "Name des Ziels nicht auflösbar",
        ZielUngueltig => "Adresse ungültig",
        ZuGross => "Antwort zu groß",
        AntwortUngueltig => "Antwort nicht lesbar",
        GeheimnisFehlt => "Geheimnis fehlt",
        GeheimnisUnlesbar => "Geheimnis mit anderem Schlüssel gesetzt",
        GeheimnisspeicherGesperrt => "Geheimnisspeicher ohne Schlüssel",
        EinstellungUngueltig => "Einstellung ungültig",
        VersionUnbekannt => "Unbekannte Schnittstellenversion",
        Intern => "Fehler im Server",
        SchluesselPassenNicht => {
            "Schlüssel passen nicht zum Gerät des Tokens. Ein neues Access-Token anlegen."
        }
        SchluesselspeicherUnlesbar => {
            "Schlüsselspeicher nicht zu öffnen (Passphrase oder Speicher beschädigt)"
        }
    };
    match status {
        Some(s) => format!("{text} ({s})"),
        None => text.to_string(),
    }
}

/// Sprungziel: die Einzelansicht des Adapters, gebaut wie `adapterPath` in
/// `frontend/src/pages/einstellungen/adapterAnzeige.ts` (Kennung wie `encodeURIComponent`).
pub fn pfad(adapter_id: &str) -> String {
    let mut kodiert = String::with_capacity(adapter_id.len());
    for b in adapter_id.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            kodiert.push(char::from(b));
        } else {
            kodiert.push_str(&format!("%{b:02X}"));
        }
    }
    format!("/admin/einstellungen/anbindungen/adapter/{kodiert}")
}

/// Titel, Detailzeile und Pfad einer Störungsmeldung, gelesen beim Lesen aus der Adapterzeile.
/// `None`, wenn es den Adapter nicht mehr gibt.
pub async fn text(
    pool: &SqlitePool,
    art: BenachrichtigungArt,
    adapter_id: &str,
) -> Result<Option<Text>, AppError> {
    let zeile: Option<(String, Option<String>, Option<String>, Option<i64>)> =
        sqlx::query_as(sqlx::AssertSqlSafe(detail_sql()))
            .bind(adapter_id)
            .fetch_optional(pool)
            .await?;
    let Some((name, angehalten_grund, letzter_fehler_art, letzter_status)) = zeile else {
        return Ok(None);
    };
    let fehler = match art {
        BenachrichtigungArt::AdapterEingriff => angehalten_grund.or(letzter_fehler_art.clone()),
        BenachrichtigungArt::AdapterGestoert => letzter_fehler_art.clone(),
        _ => None,
    };
    let detail = match fehler.as_deref().and_then(AdapterFehler::parse) {
        Some(f) => {
            // Der Status gehört nur zum Fehler, der ihn zuletzt brachte.
            let status =
                letzter_status.filter(|_| letzter_fehler_art.as_deref() == Some(f.as_str()));
            format!("{name} · {}", fehler_text(f, status))
        }
        None => name,
    };
    Ok(Some(Text {
        titel: titel(art).to_string(),
        detail: Some(detail),
        pfad: pfad(adapter_id),
    }))
}
