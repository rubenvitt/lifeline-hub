//! Text einer Benachrichtigung, beim Lesen gebildet (design.md D1: keine Textspalte).
//!
//! Je Art ein Titel (Wortlaut der Spec), je Bezug eine Detailzeile und ein Sprungpfad. Die
//! Detailzeile liest **nur Retain-Spalten** der Schwärzungs-Registry (Nummern, Enums,
//! operative Labels), nie einen Scrub-Wert (`src/AGENTS.md`, Aufbewahrung, Scrub-Werte): Guard
//! `detail_liest_nur_retain_spalten`. Spätere Teilaufgaben verfeinern hier die Texte ihrer Art.

use super::{BenachrichtigungArt, BenachrichtigungBezugTyp, Bezug};
use crate::error::AppError;
use crate::fuehrung::Fuehrungsfunktion;
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
        // Mehr als eine Spalte: eigener Weg über `AUFTRAG_EMPFAENGER_SPALTEN`.
        BenachrichtigungBezugTyp::AuftragEmpfaenger => None,
        // Titel und Freitexte dieser Objekte sind Scrub-Werte; ihr Titel genügt.
        BenachrichtigungBezugTyp::Befehl
        | BenachrichtigungBezugTyp::Lagebericht
        | BenachrichtigungBezugTyp::Erinnerung
        | BenachrichtigungBezugTyp::Abloesung
        | BenachrichtigungBezugTyp::Lagebesprechung
        | BenachrichtigungBezugTyp::Gefahrengebiet
        | BenachrichtigungBezugTyp::ChatNachricht => None,
    }
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
        // Die Kennung ist die Empfänger-Zeile; den Auftrag setzt `bilden` ein, sobald es die
        // Zeile gelesen hat. Ohne Zeile bleibt die Liste.
        BenachrichtigungBezugTyp::AuftragEmpfaenger => format!("{basis}/auftraege"),
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

/// Was die Detailzeile einer Empfänger-Zeile liest (Quittung, LLH-1212), als `(Tabelle,
/// Spalte)`: Nummer des Auftrags und der Empfänger über Katalogcode oder den operativen Namen von
/// Einheit, Abschnitt und Fahrzeug. Nie `snap_anzeige`, `funktion_text` oder
/// `extern_bezeichnung`: die sind Scrub-Werte und tragen bei einer Person ihren Namen. Der Guard
/// `detail_liest_nur_retain_spalten` prüft jede Spalte dieser Liste; die Abfrage in
/// [`auftrag_empfaenger_text`] liest keine andere.
pub const AUFTRAG_EMPFAENGER_SPALTEN: &[(&str, &str)] = &[
    ("auftrag_empfaenger", "auftrag_id"),
    ("auftrag_empfaenger", "empfaenger_typ"),
    ("auftrag_empfaenger", "funktion"),
    ("auftrag_empfaenger", "einheit_id"),
    ("auftrag_empfaenger", "abschnitt_id"),
    ("auftrag_empfaenger", "fahrzeug_id"),
    ("auftrag", "einsatz_id"),
    ("auftrag", "lfd_nr"),
    ("einsatz_einheit", "name"),
    ("einsatzabschnitt", "name"),
    ("einsatz_fahrzeug", "snap_funkrufname"),
];

/// Die Abfrage der Detailzeile einer Empfänger-Zeile; liest nur [`AUFTRAG_EMPFAENGER_SPALTEN`].
pub const AUFTRAG_EMPFAENGER_SQL: &str =
    "SELECT ae.auftrag_id, a.lfd_nr, ae.empfaenger_typ, ae.funktion, ee.name, ea.name, \
            ef.snap_funkrufname \
     FROM auftrag_empfaenger ae JOIN auftrag a ON a.id = ae.auftrag_id \
     LEFT JOIN einsatz_einheit ee ON ee.id = ae.einheit_id \
     LEFT JOIN einsatzabschnitt ea ON ea.id = ae.abschnitt_id \
     LEFT JOIN einsatz_fahrzeug ef ON ef.id = ae.fahrzeug_id \
     WHERE ae.id = ? AND a.einsatz_id = ?";

type EmpfaengerZeile = (
    i64,
    Option<i64>,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
);

/// Text zu einer Empfänger-Zeile: „Auftrag #12 an S2“, bei einer Person ohne Namen nur
/// „Auftrag #12“. Der Sprung führt zum Auftrag.
async fn auftrag_empfaenger_text(
    pool: &SqlitePool,
    einsatz_id: i64,
    art: BenachrichtigungArt,
    bezug: Bezug,
) -> Result<Text, AppError> {
    let zeile: Option<EmpfaengerZeile> = sqlx::query_as(AUFTRAG_EMPFAENGER_SQL)
        .bind(bezug.id)
        .bind(einsatz_id)
        .fetch_optional(pool)
        .await?;
    let Some((auftrag_id, lfd_nr, typ, funktion, einheit, abschnitt, fahrzeug)) = zeile else {
        return Ok(Text {
            titel: titel(art).to_string(),
            detail: None,
            pfad: pfad(einsatz_id, bezug),
        });
    };
    let empfaenger = match (
        typ.as_str(),
        funktion.as_deref().and_then(Fuehrungsfunktion::parse),
    ) {
        ("funktion", Some(f)) => match f.kuerzel() {
            Some(k) => Some(k.to_string()),
            // Führungshilfspersonal und Fachberater: das wirksame Label, ohne die Bezeichnung
            // (`funktion_text` ist ein Scrub-Wert).
            None => {
                let mut conn = pool.acquire().await?;
                let karte =
                    crate::fuehrung::repo::labelkarte_fuer_einsatz(&mut conn, einsatz_id).await?;
                Some(karte.label(f).to_string())
            }
        },
        ("einheit", _) => einheit,
        ("abschnitt", _) => abschnitt,
        ("fahrzeug", _) => fahrzeug,
        _ => None,
    }
    .filter(|n| !n.trim().is_empty());
    let auftrag = match lfd_nr {
        Some(nr) => format!("Auftrag #{nr}"),
        None => "Auftrag".to_string(),
    };
    Ok(Text {
        titel: titel(art).to_string(),
        detail: Some(match empfaenger {
            Some(e) => format!("{auftrag} an {e}"),
            None => auftrag,
        }),
        pfad: pfad(
            einsatz_id,
            Bezug::neu(BenachrichtigungBezugTyp::Auftrag, auftrag_id),
        ),
    })
}

/// Bildet den Text einer Benachrichtigung. Ein gelöschter Bezug lässt nur die Detailzeile weg.
pub async fn bilden(
    pool: &SqlitePool,
    einsatz_id: i64,
    art: BenachrichtigungArt,
    bezug: Bezug,
) -> Result<Text, AppError> {
    if bezug.typ == BenachrichtigungBezugTyp::AuftragEmpfaenger {
        return auftrag_empfaenger_text(pool, einsatz_id, art, bezug).await;
    }
    let detail = match detail_quelle(bezug.typ) {
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
