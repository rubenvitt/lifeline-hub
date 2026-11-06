//! Lesen und Schreiben der Programmpunkte (LLH-1570). Jede Abfrage ist auf den Einsatz
//! geschnitten: ein Programmpunkt eines fremden Einsatzes ist nicht da (404).

use super::{Programmpunkt, PROGRAMMPUNKTE_MAX};
use crate::error::AppError;
use sqlx::SqlitePool;

/// Alle Programmpunkte des Einsatzes nach Zeitpunkt, auch die verstrichenen: das Paneel zeigt den
/// ganzen Ablauf, nur die Marken lassen Verstrichenes fallen.
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<Programmpunkt>, AppError> {
    Ok(sqlx::query_as::<_, Programmpunkt>(
        "SELECT id, bezeichnung, zeitpunkt_at FROM programmpunkt \
         WHERE einsatz_id = ? ORDER BY zeitpunkt_at, id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?)
}

/// Die nächsten `anzahl` Programmpunkte echt nach `jetzt` (Lagemonitor, design.md D4).
pub async fn anstehende(
    pool: &SqlitePool,
    einsatz_id: i64,
    jetzt: &str,
    anzahl: i64,
) -> Result<Vec<Programmpunkt>, AppError> {
    Ok(sqlx::query_as::<_, Programmpunkt>(
        "SELECT id, bezeichnung, zeitpunkt_at FROM programmpunkt \
         WHERE einsatz_id = ? AND zeitpunkt_at > ? ORDER BY zeitpunkt_at, id LIMIT ?",
    )
    .bind(einsatz_id)
    .bind(jetzt)
    .bind(anzahl)
    .fetch_all(pool)
    .await?)
}

/// Legt einen Programmpunkt an. Die Obergrenze prüft dieselbe Anweisung, damit zwei gleichzeitige
/// Anlagen sie nicht gemeinsam überschreiten; voll ist 422.
pub async fn anlegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    bezeichnung: &str,
    zeitpunkt_at: &str,
) -> Result<Programmpunkt, AppError> {
    let neu = sqlx::query_as::<_, Programmpunkt>(
        "INSERT INTO programmpunkt (einsatz_id, bezeichnung, zeitpunkt_at, erstellt_von_id) \
         SELECT ?, ?, ?, ? \
         WHERE (SELECT COUNT(*) FROM programmpunkt WHERE einsatz_id = ?) < ? \
         RETURNING id, bezeichnung, zeitpunkt_at",
    )
    .bind(einsatz_id)
    .bind(bezeichnung)
    .bind(zeitpunkt_at)
    .bind(benutzer_id)
    .bind(einsatz_id)
    .bind(PROGRAMMPUNKTE_MAX)
    .fetch_optional(pool)
    .await?;
    neu.ok_or_else(|| {
        AppError::UnprocessableEntity(format!(
            "Ein Einsatz hat höchstens {PROGRAMMPUNKTE_MAX} Programmpunkte"
        ))
    })
}

/// Ändert Bezeichnung und/oder Zeitpunkt; `None` lässt das Feld stehen. Unbekannt oder fremd: 404.
pub async fn aendern(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    bezeichnung: Option<&str>,
    zeitpunkt_at: Option<&str>,
) -> Result<Programmpunkt, AppError> {
    sqlx::query_as::<_, Programmpunkt>(
        "UPDATE programmpunkt SET \
           bezeichnung = COALESCE(?, bezeichnung), \
           zeitpunkt_at = COALESCE(?, zeitpunkt_at), \
           geaendert_at = datetime('now') \
         WHERE id = ? AND einsatz_id = ? \
         RETURNING id, bezeichnung, zeitpunkt_at",
    )
    .bind(bezeichnung)
    .bind(zeitpunkt_at)
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Löscht einen Programmpunkt. Unbekannt oder fremd: 404.
pub async fn loeschen(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<(), AppError> {
    let r = sqlx::query("DELETE FROM programmpunkt WHERE id = ? AND einsatz_id = ?")
        .bind(id)
        .bind(einsatz_id)
        .execute(pool)
        .await?;
    if r.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}
