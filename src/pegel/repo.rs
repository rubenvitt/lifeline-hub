//! Persistenz der festgelegten Pegel (LFH-606, Tabelle `einsatz_pegel`).
//!
//! Ersetzen hält die Zeilen stabil: eine Station, die in der neuen Liste bleibt, behält
//! `id`, `gesetzt_von_id` und `gesetzt_at` — umgeordnet wird nur `reihenfolge` (und der
//! Namens-Snapshot aufgefrischt). Ein Löschen-und-neu-Anlegen hätte bei jedem Umordnen neue
//! ids und einen falschen „gesetzt am" erzeugt.

use sqlx::SqlitePool;

use super::PEGEL_MAX;
use crate::error::AppError;
use crate::write_retry;

/// Validierte Eingabe (UUID kleingeschrieben, Texte getrimmt).
#[derive(Debug, Clone, PartialEq)]
pub struct PegelEingabe {
    pub station_uuid: String,
    pub name: String,
    pub gewaesser: Option<String>,
}

/// Eine Zeile, wie sie die Anzeige braucht.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PegelZeile {
    pub id: i64,
    pub station_uuid: String,
    pub name: String,
    pub gewaesser: Option<String>,
    pub reihenfolge: i64,
}

/// Alle festgelegten Pegel eines Einsatzes in Reihenfolge.
pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<PegelZeile>, AppError> {
    Ok(sqlx::query_as::<_, PegelZeile>(
        "SELECT id, station_uuid, name, gewaesser, reihenfolge FROM einsatz_pegel \
         WHERE einsatz_id = ? ORDER BY reihenfolge, id",
    )
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?)
}

/// Ersetzt die Liste vollständig; Reihenfolge = Position im Slice. Die Route hat Länge und
/// Eindeutigkeit bereits geprüft (400/422) — der UNIQUE-Index bliebe sonst als 409 übrig.
pub async fn ersetzen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    eintraege: &[PegelEingabe],
) -> Result<(), AppError> {
    let uuids = serde_json::to_string(
        &eintraege
            .iter()
            .map(|e| e.station_uuid.as_str())
            .collect::<Vec<_>>(),
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;
    write_retry!(pool, |conn| {
        sqlx::query(
            "DELETE FROM einsatz_pegel WHERE einsatz_id = ? \
             AND station_uuid NOT IN (SELECT value FROM json_each(?))",
        )
        .bind(einsatz_id)
        .bind(&uuids)
        .execute(&mut *conn)
        .await?;
        for (i, e) in eintraege.iter().enumerate() {
            sqlx::query(
                "INSERT INTO einsatz_pegel \
                 (einsatz_id, station_uuid, name, gewaesser, reihenfolge, gesetzt_von_id) \
                 VALUES (?, ?, ?, ?, ?, ?) \
                 ON CONFLICT(einsatz_id, station_uuid) DO UPDATE SET \
                 name = excluded.name, gewaesser = excluded.gewaesser, \
                 reihenfolge = excluded.reihenfolge",
            )
            .bind(einsatz_id)
            .bind(&e.station_uuid)
            .bind(&e.name)
            .bind(&e.gewaesser)
            .bind(i as i64)
            .bind(benutzer_id)
            .execute(&mut *conn)
            .await?;
        }
        Ok(())
    })
}

/// Fügt einen Pegel hinten an. `Ok(false)`, wenn die Station schon festgelegt ist (dann
/// bleibt alles, wie es ist — idempotent). Die Obergrenze wird erst NACH der
/// Vorhandensein-Prüfung geprüft: ein wiederholter POST bei voller Liste ist kein Fehler.
pub async fn anfuegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    e: &PegelEingabe,
) -> Result<bool, AppError> {
    write_retry!(pool, |conn| {
        let vorhanden: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM einsatz_pegel WHERE einsatz_id = ? AND station_uuid = ?",
        )
        .bind(einsatz_id)
        .bind(&e.station_uuid)
        .fetch_optional(&mut *conn)
        .await?;
        if vorhanden.is_some() {
            return Ok(false);
        }
        let (anzahl, naechste): (i64, i64) = sqlx::query_as(
            "SELECT COUNT(*), COALESCE(MAX(reihenfolge) + 1, 0) FROM einsatz_pegel \
             WHERE einsatz_id = ?",
        )
        .bind(einsatz_id)
        .fetch_one(&mut *conn)
        .await?;
        if anzahl as usize >= PEGEL_MAX {
            return Err(AppError::Validation(format!(
                "Höchstens {PEGEL_MAX} Pegel je Einsatz"
            )));
        }
        sqlx::query(
            "INSERT INTO einsatz_pegel \
             (einsatz_id, station_uuid, name, gewaesser, reihenfolge, gesetzt_von_id) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(einsatz_id)
        .bind(&e.station_uuid)
        .bind(&e.name)
        .bind(&e.gewaesser)
        .bind(naechste)
        .bind(benutzer_id)
        .execute(&mut *conn)
        .await?;
        Ok(true)
    })
}
