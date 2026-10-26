//! Verbindungen außerhalb des Funks an Abschnitt, Einheit und eigener Führungsstelle (LLH-1134,
//! Entscheidung LLH-1126 Option B): typisiert wie die Stellen des Kommunikationsplans
//! (`stab::kommunikation`, Mittel festnetz | mobil | fax | email | messenger | melder |
//! sonstiges, Wert, Hinweis). Funk zeigt sich am Datensatz über Rufname und Sprechgruppen.
//!
//! Eine Tabelle `einsatz_verbindung` (Migration 0248) mit typisiertem Bezug und echten
//! Fremdschlüsseln: das Löschen eines Abschnitts oder einer Einheit räumt per Kaskade mit. Der
//! Schreibweg ist eine Ersatzliste im PATCH bzw. POST des Datensatzes (`verbindungen`, wie
//! `sprechgruppe_ids`); Live-Ereignis und Rechte folgen dem Datensatz.
//!
//! Die Werte sind personenbezogen: Schwärzung (`schwaerzung_registry`, Personen-Scrub über die
//! führende Person in `schwaerzung_person`) und Personensuche (`aufbewahrung::suche`) kennen sie.
//! Die alten Spalten `kommunikationsmittel`/`erreichbarkeit` sind entfernt (LLH-1418); ein Body,
//! der die Felder noch trägt, ist 400 ([`lehne_altfelder_ab`]).

use std::collections::HashMap;

use serde::Deserialize;
use sqlx::{SqliteConnection, SqlitePool};

use crate::error::AppError;
use crate::stab::kommunikation::{KommunikationsVerbindung, Verbindungsmittel, TEXT_MAX};

/// Höchstzahl der Verbindungen je Datensatz (`src/AGENTS.md`, „Eingabegrenzen“). Spiegel:
/// `VERBINDUNGEN_MAX` in `frontend/src/api/eingabegrenzen.ts`.
pub const VERBINDUNGEN_MAX: usize = 10;

/// Höchstlänge von Wert und Hinweis, wie im Kommunikationsplan. Spiegel:
/// `VERBINDUNG_TEXT_MAX` in `frontend/src/api/eingabegrenzen.ts`.
pub const VERBINDUNG_TEXT_MAX: usize = TEXT_MAX;

/// Höchstlänge des Rufnamens eines Abschnitts, wie der Funkrufname einer Einheit
/// (`einheit::FUNKRUFNAME_MAX`). Spiegel: `ABSCHNITT_RUFNAME_MAX`.
pub const ABSCHNITT_RUFNAME_MAX: usize = 200;

/// Wem eine Verbindung gehört.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bezug {
    Abschnitt(i64),
    Einheit(i64),
    /// Die eigene Führungsstelle des Einsatzes (eine je Einsatz).
    Fuehrungsstelle,
}

impl Bezug {
    fn art(self) -> &'static str {
        match self {
            Bezug::Abschnitt(_) => "abschnitt",
            Bezug::Einheit(_) => "einheit",
            Bezug::Fuehrungsstelle => "fuehrungsstelle",
        }
    }
    fn abschnitt_id(self) -> Option<i64> {
        match self {
            Bezug::Abschnitt(id) => Some(id),
            _ => None,
        }
    }
    fn einheit_id(self) -> Option<i64> {
        match self {
            Bezug::Einheit(id) => Some(id),
            _ => None,
        }
    }
}

/// Eine Verbindung im Body (`verbindungen` an Abschnitt, Einheit, Führungsstelle).
#[derive(Debug, Clone, Deserialize)]
pub struct VerbindungBody {
    /// Wire-Wert von [`Verbindungsmittel`]; als String gelesen, damit ein unbekannter Wert eine
    /// sprechende 400 bekommt.
    pub mittel: String,
    pub wert: String,
    pub hinweis: Option<String>,
}

/// Eine geprüfte Verbindung zum Schreiben.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verbindung {
    pub mittel: Verbindungsmittel,
    pub wert: String,
    pub hinweis: Option<String>,
}

/// Prüft eine Ersatzliste vor jedem Schreiben (`src/AGENTS.md`, Statuscode-Konvention: alles
/// 400, das Feld ist für sich unbrauchbar): höchstens [`VERBINDUNGEN_MAX`], bekanntes Mittel,
/// Wert nach dem Trimmen nicht leer, Wert und Hinweis höchstens [`VERBINDUNG_TEXT_MAX`] Zeichen;
/// ein leerer Hinweis gilt als keiner.
pub fn pruefe_liste(roh: Vec<VerbindungBody>) -> Result<Vec<Verbindung>, AppError> {
    if roh.len() > VERBINDUNGEN_MAX {
        return Err(AppError::Validation(format!(
            "Höchstens {VERBINDUNGEN_MAX} Verbindungen je Datensatz"
        )));
    }
    roh.into_iter()
        .map(|v| {
            let mittel = Verbindungsmittel::parse(v.mittel.trim()).ok_or_else(|| {
                AppError::Validation(format!(
                    "Unbekanntes Verbindungsmittel «{}» (erlaubt: {})",
                    v.mittel,
                    Verbindungsmittel::ALLE
                        .iter()
                        .map(|m| m.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ))
            })?;
            let wert = v.wert.trim().to_string();
            if wert.is_empty() {
                return Err(AppError::Validation(
                    "Eine Verbindung braucht eine Nummer oder Adresse".into(),
                ));
            }
            if wert.chars().count() > VERBINDUNG_TEXT_MAX {
                return Err(AppError::Validation(format!(
                    "Nummer bzw. Adresse darf höchstens {VERBINDUNG_TEXT_MAX} Zeichen lang sein"
                )));
            }
            let hinweis = v
                .hinweis
                .map(|h| h.trim().to_string())
                .filter(|h| !h.is_empty());
            if hinweis
                .as_deref()
                .is_some_and(|h| h.chars().count() > VERBINDUNG_TEXT_MAX)
            {
                return Err(AppError::Validation(format!(
                    "Hinweis darf höchstens {VERBINDUNG_TEXT_MAX} Zeichen lang sein"
                )));
            }
            Ok(Verbindung {
                mittel,
                wert,
                hinweis,
            })
        })
        .collect()
}

/// Ein veralteter Client schreibt noch `kommunikationsmittel` oder `erreichbarkeit`: 400 statt
/// stillem Verwerfen (LLH-1134, design.md D2). `vorhanden` ist, ob der Body den Schlüssel trug.
pub fn lehne_altfelder_ab(
    kommunikationsmittel: bool,
    erreichbarkeit: bool,
) -> Result<(), AppError> {
    if kommunikationsmittel || erreichbarkeit {
        return Err(AppError::Validation(
            "Kommunikationsmittel und Erreichbarkeit werden nicht mehr geführt: Telefon und \
             weitere Verbindungen stehen in „verbindungen“ (Seite neu laden)"
                .into(),
        ));
    }
    Ok(())
}

/// Ersetzt die Verbindungen des Bezugs vollständig, in der offenen Transaktion des Aufrufers.
/// Der Aufrufer hat den Datensatz im Einsatz schon gefunden (sonst 404 vor dem Schreiben).
pub async fn ersetzen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    bezug: Bezug,
    liste: &[Verbindung],
) -> Result<(), AppError> {
    sqlx::query(
        "DELETE FROM einsatz_verbindung WHERE einsatz_id = ? AND bezug = ? \
           AND abschnitt_id IS ? AND einheit_id IS ?",
    )
    .bind(einsatz_id)
    .bind(bezug.art())
    .bind(bezug.abschnitt_id())
    .bind(bezug.einheit_id())
    .execute(&mut *conn)
    .await?;
    for (i, v) in liste.iter().enumerate() {
        sqlx::query(
            "INSERT INTO einsatz_verbindung \
                (einsatz_id, bezug, abschnitt_id, einheit_id, mittel, wert, hinweis, sortier) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(einsatz_id)
        .bind(bezug.art())
        .bind(bezug.abschnitt_id())
        .bind(bezug.einheit_id())
        .bind(v.mittel.as_str())
        .bind(&v.wert)
        .bind(v.hinweis.as_deref())
        .bind(i as i64 + 1)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// [`ersetzen_tx`] in eigener Schreibtransaktion.
pub async fn ersetzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    bezug: Bezug,
    liste: &[Verbindung],
) -> Result<(), AppError> {
    crate::write_retry!(pool, |conn| {
        ersetzen_tx(conn, einsatz_id, bezug, liste).await
    })
}

#[derive(sqlx::FromRow)]
struct Roh {
    id: i64,
    bezug_id: Option<i64>,
    mittel: String,
    wert: String,
    hinweis: Option<String>,
}

fn anzeige(r: Roh) -> KommunikationsVerbindung {
    KommunikationsVerbindung {
        id: r.id,
        // Der CHECK schließt einen unbekannten Wert aus; er fiele auf „sonstiges“ zurück.
        mittel: Verbindungsmittel::parse(&r.mittel).unwrap_or(Verbindungsmittel::Sonstiges),
        wert: r.wert,
        hinweis: r.hinweis,
    }
}

/// Die Verbindungen aller Abschnitte (`Bezug::Abschnitt`) bzw. Einheiten (`Bezug::Einheit`) eines
/// Einsatzes in EINER Abfrage, je Datensatz in Eingabefolge. Die id im Bezug wird ignoriert.
pub async fn lade_map(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    art: Bezug,
) -> Result<HashMap<i64, Vec<KommunikationsVerbindung>>, AppError> {
    let spalte = match art {
        Bezug::Abschnitt(_) => "abschnitt_id",
        Bezug::Einheit(_) => "einheit_id",
        Bezug::Fuehrungsstelle => {
            return Err(AppError::Internal(
                "lade_map gilt nur für Abschnitte und Einheiten".into(),
            ))
        }
    };
    let zeilen = sqlx::query_as::<_, Roh>(sqlx::AssertSqlSafe(format!(
        "SELECT id, {spalte} AS bezug_id, mittel, wert, hinweis FROM einsatz_verbindung \
         WHERE einsatz_id = ? AND bezug = ? ORDER BY sortier, id"
    )))
    .bind(einsatz_id)
    .bind(art.art())
    .fetch_all(&mut *conn)
    .await?;
    let mut map: HashMap<i64, Vec<KommunikationsVerbindung>> = HashMap::new();
    for z in zeilen {
        if let Some(b) = z.bezug_id {
            map.entry(b).or_default().push(anzeige(z));
        }
    }
    Ok(map)
}

/// Die Verbindungen der eigenen Führungsstelle in Eingabefolge.
pub async fn lade_fuehrungsstelle(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Vec<KommunikationsVerbindung>, AppError> {
    let zeilen = sqlx::query_as::<_, Roh>(
        "SELECT id, NULL AS bezug_id, mittel, wert, hinweis FROM einsatz_verbindung \
         WHERE einsatz_id = ? AND bezug = 'fuehrungsstelle' ORDER BY sortier, id",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen.into_iter().map(anzeige).collect())
}

#[cfg(test)]
#[path = "verbindungen_tests.rs"]
mod tests;
