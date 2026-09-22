//! ETB-Lesemarke je Benutzer und Einsatz (LFH-611, Neuentwurf S4): „14 neue Einträge seit
//! Ihrer letzten Sichtung um 13:04 · alle als gesichtet markieren".
//!
//! Die Marke ist eine GRENZE über `lfd_nr` (Begründung im Kopf von
//! `migrations/0103_etb_lesemarke.sql`). Sie läuft nur vorwärts und wird nur ausdrücklich
//! gesetzt — Öffnen oder Blättern im Tagebuch verschiebt sie nicht.
//!
//! Abgrenzung zu LFH-612: hier entsteht ausschließlich der Zähler RELATIV zur Marke, kein
//! allgemeiner ETB-Gesamtzähler.

use crate::error::AppError;
use serde::Serialize;
use sqlx::SqlitePool;
use utoipa::ToSchema;

/// Lesestand einer Person im Tagebuch eines Einsatzes.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct EtbLesemarkeAnzeige {
    /// Bis zu dieser laufenden Nummer hat die Person das Tagebuch als gesichtet markiert.
    /// Fehlt, solange sie es noch nie getan hat.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gesichtet_lfd_nr: Option<i64>,
    /// Wann die Marke zuletzt vorgerückt ist (UTC, SQLite-Format). Fehlt ohne Marke.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gesichtet_at: Option<String>,
    /// Einträge ANDERER Erfasser über der Marke (ohne Marke: alle fremden Einträge). Die
    /// eigenen zählen nie — wer sie geschrieben hat, hat sie gesehen.
    pub neue_anzahl: i64,
    /// Höchste vergebene laufende Nummer im Einsatz zum Zeitpunkt der Antwort; fehlt bei
    /// leerem Tagebuch. „Alle als gesichtet markieren" schickt GENAU diesen Wert zurück:
    /// markiert wird, was angesagt war — nicht, was zwischen Anzeige und Klick eintraf.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hoechste_lfd_nr: Option<i64>,
}

/// Liest den Lesestand von `benutzer_id` im Einsatz `einsatz_id`.
pub async fn laden(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
) -> Result<EtbLesemarkeAnzeige, AppError> {
    let marke: Option<(i64, String)> = sqlx::query_as(
        "SELECT gesichtet_lfd_nr, gesichtet_at FROM etb_lesemarke \
         WHERE einsatz_id = ? AND benutzer_id = ?",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .fetch_optional(pool)
    .await?;
    let grenze = marke.as_ref().map(|(nr, _)| *nr).unwrap_or(0);

    let (neue_anzahl, hoechste_lfd_nr): (i64, Option<i64>) = sqlx::query_as(
        "SELECT COALESCE(SUM(CASE WHEN lfd_nr > ? AND erfasser_id <> ? THEN 1 ELSE 0 END), 0), \
                MAX(lfd_nr) \
         FROM etb_eintrag WHERE einsatz_id = ?",
    )
    .bind(grenze)
    .bind(benutzer_id)
    .bind(einsatz_id)
    .fetch_one(pool)
    .await?;

    let (gesichtet_lfd_nr, gesichtet_at) = match marke {
        Some((nr, at)) => (Some(nr), Some(at)),
        None => (None, None),
    };
    Ok(EtbLesemarkeAnzeige {
        gesichtet_lfd_nr,
        gesichtet_at,
        neue_anzahl,
        hoechste_lfd_nr,
    })
}

/// Setzt die Marke auf `bis_lfd_nr` — nur vorwärts. Ein verspäteter Request mit älterem
/// Stand (zweiter Tab) dreht weder die Nummer zurück noch behauptet er eine neuere Sichtung:
/// `gesichtet_at` rückt nur mit, wenn die Nummer rückt.
///
/// Die Obergrenze prüft der Aufrufer (422, eine Sichtung von Einträgen, die es nicht gibt).
pub async fn setzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    bis_lfd_nr: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO etb_lesemarke (einsatz_id, benutzer_id, gesichtet_lfd_nr, gesichtet_at) \
         VALUES (?, ?, ?, datetime('now')) \
         ON CONFLICT (einsatz_id, benutzer_id) DO UPDATE SET \
           gesichtet_at = CASE WHEN excluded.gesichtet_lfd_nr > etb_lesemarke.gesichtet_lfd_nr \
                               THEN excluded.gesichtet_at ELSE etb_lesemarke.gesichtet_at END, \
           gesichtet_lfd_nr = MAX(etb_lesemarke.gesichtet_lfd_nr, excluded.gesichtet_lfd_nr)",
    )
    .bind(einsatz_id)
    .bind(benutzer_id)
    .bind(bis_lfd_nr)
    .execute(pool)
    .await?;
    Ok(())
}
