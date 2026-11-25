//! Positionsbaustein (Helfer-App, Spec `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`,
//! Abschnitt „Ortung der Organisation und Positionsbaustein“): die eine Schreibstelle für
//! automatische Positionen an Einheit, Fahrzeug und Person.
//!
//! - Jede Position trägt ihre Quelle (`position_quelle`) und ihren Zeitpunkt
//!   (`position_aktualisiert_at`, kanonisches Format aus [`crate::zeit`]).
//! - Eine automatische Position, die älter ist als die gespeicherte, wird verworfen. Das gilt nur
//!   hier: die Handwege (`PATCH …/position`) schreiben mit Quelle `manuell` und der Serverzeit
//!   und werden nie verworfen.
//! - Geschrieben wird mit einem einfachen `UPDATE` wie an den Handwegen; an einem gespiegelten
//!   Einsatz bricht der Schutz-Trigger es ab (`einsatz_ist_spiegel`), und das Änderungslog nimmt
//!   die neuen Spalten über das Schema mit.
//! - Das Live-Ereignis löst der Aufrufer nach dem Commit mit [`publiziere`] aus.

use chrono::{DateTime, TimeDelta, Utc};
use sqlx::SqliteConnection;

use crate::app::AppState;
use crate::error::AppError;
use crate::wire_enum::wire_enum;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

wire_enum! {
    /// Woher eine Position stammt; Wire- und Spaltenwert (`position_quelle`, CHECK in Migration
    /// 0373) `manuell`, `einwurf`, `helfer`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum Positionsquelle {
        /// Von Hand auf der Lagekarte gesetzt.
        Manuell => "manuell",
        /// Über den Einwurf (LLH-1654/LLH-2091).
        Einwurf => "einwurf",
        /// Von der Helfer-App gesendet.
        Helfer => "helfer",
    }
}

/// Wo eine Position landet: Kennung der Zeile in `einsatz_einheit`, `einsatz_fahrzeug` oder
/// `einsatz_personal`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ortungsziel {
    Einheit(i64),
    Fahrzeug(i64),
    Person(i64),
}

impl Ortungsziel {
    fn tabelle(self) -> &'static str {
        match self {
            Self::Einheit(_) => "einsatz_einheit",
            Self::Fahrzeug(_) => "einsatz_fahrzeug",
            Self::Person(_) => "einsatz_personal",
        }
    }

    fn id(self) -> i64 {
        match self {
            Self::Einheit(id) | Self::Fahrzeug(id) | Self::Person(id) => id,
        }
    }
}

/// Wie weit die Uhr eines Geräts vorgehen darf, bevor sein Zeitpunkt der Serverzeit weicht.
const VORLAUF: TimeDelta = TimeDelta::seconds(60);

/// Liest einen Zeitpunkt als RFC 3339 (mit Versatz) oder im kanonischen Format (UTC).
fn lies_zeitpunkt(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|t| t.with_timezone(&Utc))
        .ok()
        .or_else(|| crate::zeit::parse_utc(s))
}

/// Klemmt den Zeitpunkt eines Geräts: mehr als 60 s in der Zukunft (gemessen an `jetzt`) wird
/// `jetzt`, sonst bleibt er unverändert. Ein unlesbarer Gerätezeitpunkt wird ebenfalls `jetzt`.
pub fn klemme_zeitpunkt(geraet: &str, jetzt: &str) -> String {
    match (lies_zeitpunkt(geraet), lies_zeitpunkt(jetzt)) {
        (Some(g), Some(j)) if g - j <= VORLAUF => geraet.to_string(),
        (Some(_), None) => geraet.to_string(),
        _ => jetzt.to_string(),
    }
}

/// Schreibt eine Position an das Ziel. `true` = geschrieben, `false` = älter als die gespeicherte
/// und verworfen (gleich alt wird geschrieben). Verworfen wird nur eine automatische Quelle; mit
/// `Manuell` gilt die Position immer, wie an den Handwegen.
///
/// - `zeitpunkt` als RFC 3339 oder kanonisch; unlesbar → `Validation` (400). Gespeichert wird
///   er kanonisch, damit die Textsortierung der Spalte stimmt.
/// - Koordinate außerhalb des Bereichs → `UnprocessableEntity` (422, `pruefe_koordinate`).
/// - Fremdes Ziel → `NotFound`; beendetes oder aufgelöstes Ziel → `Conflict` (LLH-1079).
pub async fn schreibe_position(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ziel: Ortungsziel,
    lat: f64,
    lon: f64,
    zeitpunkt: &str,
    quelle: Positionsquelle,
) -> Result<bool, AppError> {
    crate::routes::support::pruefe_koordinate(Some(lat), Some(lon), "lat", "lon")?;
    let zeitpunkt = lies_zeitpunkt(zeitpunkt)
        .map(crate::zeit::formatiere_utc)
        .ok_or_else(|| AppError::Validation("Ungültiger Zeitpunkt der Position".into()))?;
    match ziel {
        Ortungsziel::Einheit(id) => {
            crate::einheit::repo::require_aktiv_tx(conn, einsatz_id, id).await?
        }
        Ortungsziel::Fahrzeug(id) => {
            crate::fahrzeug::disposition_repo::require_aktiv_tx(conn, einsatz_id, id).await?
        }
        Ortungsziel::Person(id) => {
            crate::personal::disposition_repo::require_aktiv_tx(conn, einsatz_id, id).await?
        }
    }
    let sql = format!(
        "UPDATE {} SET lat = ?, lon = ?, position_quelle = ?, position_aktualisiert_at = ? \
         WHERE id = ? AND einsatz_id = ? \
           AND (? OR position_aktualisiert_at IS NULL OR position_aktualisiert_at <= ?)",
        ziel.tabelle()
    );
    let betroffen = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(lat)
        .bind(lon)
        .bind(quelle.as_str())
        .bind(&zeitpunkt)
        .bind(ziel.id())
        .bind(einsatz_id)
        .bind(quelle == Positionsquelle::Manuell)
        .bind(&zeitpunkt)
        .execute(&mut *conn)
        .await?
        .rows_affected();
    Ok(betroffen > 0)
}

/// Löscht die Position am Ziel (`lat`/`lon` auf NULL); Quelle und Zeitpunkt bleiben als Hinweis,
/// woher die letzte Position kam. Kein Fehler, wenn die Zeile fehlt.
pub async fn loesche_position(
    conn: &mut SqliteConnection,
    ziel: Ortungsziel,
) -> Result<(), AppError> {
    let sql = format!(
        "UPDATE {} SET lat = NULL, lon = NULL WHERE id = ?",
        ziel.tabelle()
    );
    sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(ziel.id())
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Live-Ereignis der Lagekarte für das Ziel, dasselbe wie an den Handwegen. Nach dem Commit
/// rufen.
pub fn publiziere(state: &AppState, einsatz_id: i64, ziel: Ortungsziel) {
    match ziel {
        Ortungsziel::Einheit(id) => {
            crate::routes::einsatz_einheit::sse_einheit(state, einsatz_id, id)
        }
        Ortungsziel::Fahrzeug(id) => {
            crate::routes::einsatz_fahrzeug::sse_fahrzeug(state, einsatz_id, id)
        }
        Ortungsziel::Person(id) => {
            crate::routes::einsatz_personal::sse_personal(state, einsatz_id, id)
        }
    }
}
