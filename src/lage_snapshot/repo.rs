//! Persistenz der Lage-Snapshots. `daten` liegt als JSON-String in einer `TEXT`-Spalte; die
//! Liste selektiert `daten` bewusst **nicht** (Größe). Der Capture `erzeuge` (LFH-321, Task 2)
//! sammelt das volle Lagebild über Pool-Reuse ein.

use crate::error::AppError;
use serde_json::Value;
use sqlx::SqlitePool;

use super::{LageSnapshotAnzeige, LageSnapshotDokument};

const SELECT_META: &str = "\
    SELECT id, einsatz_id, bezeichnung, notiz, stand_at, schema_version, erstellt_von, erstellt_at \
    FROM lage_snapshot";

#[derive(sqlx::FromRow)]
struct MetaRow {
    id: i64,
    einsatz_id: i64,
    bezeichnung: Option<String>,
    notiz: Option<String>,
    stand_at: String,
    schema_version: i64,
    erstellt_von: i64,
    erstellt_at: String,
}

impl MetaRow {
    fn zu_anzeige(self) -> LageSnapshotAnzeige {
        LageSnapshotAnzeige {
            id: self.id,
            einsatz_id: self.einsatz_id,
            bezeichnung: self.bezeichnung,
            notiz: self.notiz,
            stand_at: self.stand_at,
            schema_version: self.schema_version,
            erstellt_von: self.erstellt_von,
            erstellt_at: self.erstellt_at,
        }
    }
}

/// Snapshots eines Einsatzes — nur Metadaten, **ohne** `daten`. Neueste zuerst.
pub async fn liste_metadaten(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Vec<LageSnapshotAnzeige>, AppError> {
    let rows = sqlx::query_as::<_, MetaRow>(sqlx::AssertSqlSafe(format!(
        "{SELECT_META} WHERE einsatz_id = ? ORDER BY stand_at DESC, id DESC"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(MetaRow::zu_anzeige).collect())
}

#[derive(sqlx::FromRow)]
struct DokRow {
    id: i64,
    einsatz_id: i64,
    bezeichnung: Option<String>,
    notiz: Option<String>,
    stand_at: String,
    schema_version: i64,
    erstellt_von: i64,
    erstellt_at: String,
    daten: String,
}

/// Volldokument eines Snapshots (inkl. eingefrorenem `daten`-Lagebild), einsatz-gescopt.
pub async fn lade_dokument(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
) -> Result<Option<LageSnapshotDokument>, AppError> {
    let row = sqlx::query_as::<_, DokRow>(
        "SELECT id, einsatz_id, bezeichnung, notiz, stand_at, schema_version, erstellt_von, \
                erstellt_at, daten \
         FROM lage_snapshot WHERE einsatz_id = ? AND id = ?",
    )
    .bind(einsatz_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    let Some(row) = row else { return Ok(None) };
    let daten: Value = serde_json::from_str(&row.daten)
        .map_err(|e| AppError::Internal(format!("lage_snapshot.daten kein gültiges JSON: {e}")))?;
    Ok(Some(LageSnapshotDokument {
        id: row.id,
        einsatz_id: row.einsatz_id,
        bezeichnung: row.bezeichnung,
        notiz: row.notiz,
        stand_at: row.stand_at,
        schema_version: row.schema_version,
        erstellt_von: row.erstellt_von,
        erstellt_at: row.erstellt_at,
        daten,
    }))
}

/// Rohe INSERT-Primitive (genutzt von `erzeuge` und Tests). `daten` wird als JSON-String abgelegt.
#[allow(clippy::too_many_arguments)]
pub async fn insert_roh(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    bezeichnung: Option<&str>,
    notiz: Option<&str>,
    stand_at: &str,
    daten: &Value,
) -> Result<i64, AppError> {
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO lage_snapshot \
             (einsatz_id, bezeichnung, notiz, stand_at, schema_version, daten, erstellt_von) \
         VALUES (?, ?, ?, ?, 1, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(bezeichnung)
    .bind(notiz)
    .bind(stand_at)
    .bind(daten.to_string())
    .bind(benutzer_id)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// Snapshot löschen (Dokumenten-Vernichtung). `true`, wenn eine Zeile getroffen wurde.
pub async fn loesche(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<bool, AppError> {
    let res = sqlx::query("DELETE FROM lage_snapshot WHERE einsatz_id = ? AND id = ?")
        .bind(einsatz_id)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() > 0)
}
