//! Text einer Benachrichtigung, beim Lesen gebildet (design.md D1: keine Textspalte).
//!
//! Je Art ein Titel (Wortlaut der Spec), je Bezug eine Detailzeile und ein Sprungpfad. Die
//! Detailzeile liest **nur Retain-Spalten** der Schwärzungs-Registry (Nummern, Enums,
//! operative Labels), nie einen Scrub-Wert (`src/AGENTS.md`, Aufbewahrung, Scrub-Werte): Guard
//! `detail_liest_nur_retain_spalten`. Spätere Teilaufgaben verfeinern hier die Texte ihrer Art.

use super::{BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug};
use crate::error::AppError;
use sqlx::SqlitePool;

/// Der Text, den der Toast zeigt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Text {
    pub titel: String,
    pub detail: Option<String>,
    pub pfad: String,
}

/// Überschrift je Art (Spec `benachrichtigungen`, Wortlaut der Szenarien).
pub const fn titel(art: BenachrichtigungArt) -> &'static str {
    match art {
        BenachrichtigungArt::Sofortmeldung => "Sofortmeldung eingegangen",
        BenachrichtigungArt::SofortmeldungEskaliert => "Bestätigung ausstehend",
        BenachrichtigungArt::AuftragUeberfaellig => "Auftrag überfällig",
        BenachrichtigungArt::AbloesungFaellig => "Ablösung fällig",
        BenachrichtigungArt::ErinnerungFaellig => "Erinnerung fällig",
        BenachrichtigungArt::AbloesungVorwarnung => "Ablösung steht an",
        BenachrichtigungArt::AuftragErteilt => "Neuer Auftrag",
        BenachrichtigungArt::AuftragQuittiert => "Auftrag quittiert",
        BenachrichtigungArt::AuftragErledigt => "Auftrag erledigt",
        BenachrichtigungArt::Befehl => "Neuer Befehl",
        BenachrichtigungArt::Lagebericht => "Neuer Lagebericht",
        BenachrichtigungArt::Meldung => "Neue Meldung",
        BenachrichtigungArt::LagebesprechungVorher => "Lagebesprechung in 10 Minuten",
        BenachrichtigungArt::LagebesprechungFaellig => "Lagebesprechung jetzt fällig",
        BenachrichtigungArt::NachforderungStatus => "Status einer Nachforderung",
        BenachrichtigungArt::Gefahr => "Neue Gefahr",
        BenachrichtigungArt::SichtungEins => "Sichtung I",
        BenachrichtigungArt::WiederVerfuegbar => "Wieder verfügbar",
        BenachrichtigungArt::ChatErwaehnung => "Erwähnt im Chat",
        BenachrichtigungArt::EinsatzAufnahme => "Aufgenommen in einen Einsatz",
        BenachrichtigungArt::EinsatzNeu => "Neuer Einsatz",
        BenachrichtigungArt::Unwetter => "Unwetterwarnung",
    }
}

/// Woher die Detailzeile eines Bezugs kommt: Tabelle und eine Retain-Spalte. Die Zeile wird nur
/// gelesen, wenn sie zum Einsatz der Benachrichtigung gehört.
pub const fn detail_quelle(typ: BenachrichtigungBezugTyp) -> Option<(&'static str, &'static str)> {
    match typ {
        BenachrichtigungBezugTyp::Einsatz => Some(("einsatz", "bezeichnung")),
        BenachrichtigungBezugTyp::Meldung => Some(("meldung", "lfd_nr")),
        BenachrichtigungBezugTyp::Auftrag => Some(("auftrag", "lfd_nr")),
        BenachrichtigungBezugTyp::Nachforderung => Some(("nachforderung", "status")),
        BenachrichtigungBezugTyp::Person => Some(("einsatz_person", "registrier_nr")),
        BenachrichtigungBezugTyp::Einheit => Some(("einsatz_einheit", "name")),
        BenachrichtigungBezugTyp::Fahrzeug => Some(("einsatz_fahrzeug", "snap_funkrufname")),
        // Die Schicht hat keine eigene Bezeichnung: Einheit und Uhrzeit liest
        // `detail_abloesung` über [`DETAIL_ABLOESUNG_SPALTEN`].
        BenachrichtigungBezugTyp::Abloesung => None,
        // Titel und Freitexte dieser Objekte sind Scrub-Werte; ihr Titel genügt.
        BenachrichtigungBezugTyp::Befehl
        | BenachrichtigungBezugTyp::Lagebericht
        | BenachrichtigungBezugTyp::Erinnerung
        | BenachrichtigungBezugTyp::Lagebesprechung
        | BenachrichtigungBezugTyp::Gefahrengebiet
        | BenachrichtigungBezugTyp::ChatNachricht => None,
    }
}

/// Die Spalten der Detailzeile einer Ablösung, „Florian 1, 15:30“ (Spec `kraefte-abloesung`,
/// „Hinweis in der AlarmZentrale“): Name der Einheit und Fälligkeit der Schicht, beide Retain
/// (Guard `detail_liest_nur_retain_spalten`).
pub const DETAIL_ABLOESUNG_SPALTEN: [(&str, &str); 2] = [
    ("einsatz_einheit", "name"),
    ("einsatz_abloesung", "faellig_at"),
];

/// Detailzeile einer Ablösungsschicht: Einheit und Uhrzeit der Fälligkeit (auch bei der
/// Vorwarnung) in der Anzeigezone des Einsatzes, wie die Oberfläche sie zeigt (Einsatz, sonst
/// Organisation, sonst `einsatz::nummer::ZEITZONE_VORGABE`).
async fn detail_abloesung(
    pool: &SqlitePool,
    einsatz_id: i64,
    abloesung_id: i64,
) -> Result<Option<String>, AppError> {
    let zeile = sqlx::query_as::<_, (String, String, Option<String>)>(
        "SELECT ee.name, a.faellig_at, \
                COALESCE(NULLIF(TRIM(es.zeitzone), ''), oe.zeitzone) \
         FROM einsatz_abloesung a \
         JOIN einsatz_einheit ee ON ee.id = a.einheit_id \
         JOIN einsatz e ON e.id = a.einsatz_id \
         LEFT JOIN einsatz_einstellungen es ON es.einsatz_id = e.id \
         LEFT JOIN org_einstellungen oe ON oe.org_id = e.org_id \
         WHERE a.id = ? AND a.einsatz_id = ?",
    )
    .bind(abloesung_id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    Ok(zeile.map(|(einheit, faellig_at, zone)| {
        let zone = crate::einsatz::nummer::zone_oder_vorgabe(zone.as_deref());
        match crate::zeit::parse_utc(&faellig_at) {
            Some(t) => format!("{einheit}, {}", t.with_timezone(&zone).format("%H:%M")),
            None => einheit,
        }
    }))
}

/// Formt den gelesenen Wert zur Detailzeile.
fn detail_formen(typ: BenachrichtigungBezugTyp, wert: String) -> String {
    match typ {
        BenachrichtigungBezugTyp::Meldung => format!("Meldung #{wert}"),
        BenachrichtigungBezugTyp::Auftrag => format!("Auftrag #{wert}"),
        BenachrichtigungBezugTyp::Nachforderung => format!("Status: {}", wert.replace('_', " ")),
        BenachrichtigungBezugTyp::Person => match wert.parse::<i64>() {
            Ok(nr) => format!("Person {}", crate::person::registrier_anzeige(nr)),
            Err(_) => format!("Person {wert}"),
        },
        _ => wert,
    }
}

/// Sprungziel im Frontend, gebaut wie die gleichnamigen Funktionen in
/// `frontend/src/routing/deeplinks.ts`.
pub fn pfad(einsatz_id: i64, bezug: Bezug) -> String {
    let basis = format!("/einsaetze/{einsatz_id}");
    let id = bezug.id;
    match bezug.typ {
        BenachrichtigungBezugTyp::Einsatz => basis,
        BenachrichtigungBezugTyp::Meldung => format!("{basis}/meldungen?meldung={id}"),
        BenachrichtigungBezugTyp::Auftrag => format!("{basis}/auftraege?auftrag={id}"),
        BenachrichtigungBezugTyp::Befehl => format!("{basis}/auftraege/befehle/{id}"),
        BenachrichtigungBezugTyp::Lagebericht => format!("{basis}/lageberichte/{id}"),
        BenachrichtigungBezugTyp::Erinnerung => format!("{basis}/erinnerungen"),
        BenachrichtigungBezugTyp::Abloesung => format!("{basis}/abloesung"),
        BenachrichtigungBezugTyp::Lagebesprechung => format!("{basis}/lagebesprechung"),
        BenachrichtigungBezugTyp::Nachforderung => format!("{basis}/nachforderungen"),
        BenachrichtigungBezugTyp::Gefahrengebiet => {
            format!("{basis}/lagekarte?gefahrengebiet={id}")
        }
        BenachrichtigungBezugTyp::Person => format!("{basis}/personen/{id}"),
        BenachrichtigungBezugTyp::Einheit => format!("{basis}/einheiten/{id}"),
        BenachrichtigungBezugTyp::Fahrzeug => format!("{basis}/fahrzeuge?fahrzeug={id}"),
        BenachrichtigungBezugTyp::ChatNachricht => format!("{basis}/chat"),
    }
}

/// Bildet den Text einer Benachrichtigung. Ein gelöschter Bezug lässt nur die Detailzeile weg.
pub async fn bilden(
    pool: &SqlitePool,
    einsatz_id: i64,
    art: BenachrichtigungArt,
    bezug: Bezug,
) -> Result<Text, AppError> {
    let detail = match detail_quelle(bezug.typ) {
        None if bezug.typ == BenachrichtigungBezugTyp::Abloesung => {
            detail_abloesung(pool, einsatz_id, bezug.id).await?
        }
        None => None,
        Some((tabelle, spalte)) => {
            // Tabelle und Spalte sind Konstanten aus `detail_quelle`, nie Eingaben.
            let sql = if tabelle == "einsatz" {
                format!("SELECT CAST({spalte} AS TEXT) FROM einsatz WHERE id = ? AND id = ?")
            } else {
                format!(
                    "SELECT CAST({spalte} AS TEXT) FROM {tabelle} WHERE id = ? AND einsatz_id = ?"
                )
            };
            let wert: Option<Option<String>> = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
                .bind(bezug.id)
                .bind(einsatz_id)
                .fetch_optional(pool)
                .await?;
            wert.flatten()
                .filter(|w| !w.trim().is_empty())
                .map(|w| detail_formen(bezug.typ, w))
        }
    };
    Ok(Text {
        titel: titel(art).to_string(),
        detail,
        pfad: pfad(einsatz_id, bezug),
    })
}
