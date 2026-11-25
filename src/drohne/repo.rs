//! Tabelle `adapter_einsatz` (LLH-2105, Migration 0373): welche Drohnenquelle in welchem Einsatz
//! zugeschaltet ist. „Laufend“ ist ein Einsatz mit Status `aktiv` (wie `fordere_aktiv`, ohne
//! Nachlauffrist).

use sqlx::SqliteConnection;

use crate::einsatz::STATUS_AKTIV;
use crate::error::AppError;

/// Eine Zeile von `adapter_einsatz`.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct Zuschaltung {
    pub adapter_id: String,
    pub einsatz_id: i64,
    pub zugeschaltet_at: String,
    pub lagemonitor: bool,
}

/// Alle Zuschaltungen eines Einsatzes, auch eines abgeschlossenen.
pub async fn load_for_einsatz(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Vec<Zuschaltung>, AppError> {
    Ok(sqlx::query_as::<_, Zuschaltung>(
        "SELECT adapter_id, einsatz_id, zugeschaltet_at, lagemonitor FROM adapter_einsatz \
         WHERE einsatz_id = ? ORDER BY adapter_id",
    )
    .bind(einsatz_id)
    .fetch_all(conn)
    .await?)
}

/// Die Adapter, die in mindestens einem laufenden Einsatz zugeschaltet sind.
pub async fn load_active_adapter_ids(conn: &mut SqliteConnection) -> Result<Vec<String>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT DISTINCT ae.adapter_id FROM adapter_einsatz ae \
         JOIN einsatz e ON e.id = ae.einsatz_id WHERE e.status = ? ORDER BY ae.adapter_id",
    )
    .bind(STATUS_AKTIV)
    .fetch_all(conn)
    .await?)
}

/// Der laufende Einsatz, der den Adapter hält (`None`, wenn keiner).
pub async fn find_active_holder(
    conn: &mut SqliteConnection,
    adapter_id: &str,
) -> Result<Option<i64>, AppError> {
    Ok(sqlx::query_scalar(
        "SELECT ae.einsatz_id FROM adapter_einsatz ae \
         JOIN einsatz e ON e.id = ae.einsatz_id \
         WHERE ae.adapter_id = ? AND e.status = ? ORDER BY ae.zugeschaltet_at, ae.einsatz_id LIMIT 1",
    )
    .bind(adapter_id)
    .bind(STATUS_AKTIV)
    .fetch_optional(conn)
    .await?)
}

/// Schaltet zu oder aktualisiert die Zeile (`zugeschaltet_at` bleibt bei einer bestehenden Zeile).
pub async fn upsert(conn: &mut SqliteConnection, z: &Zuschaltung) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO adapter_einsatz (adapter_id, einsatz_id, zugeschaltet_at, lagemonitor) \
         VALUES (?, ?, ?, ?) \
         ON CONFLICT (adapter_id, einsatz_id) DO UPDATE SET lagemonitor = excluded.lagemonitor",
    )
    .bind(&z.adapter_id)
    .bind(z.einsatz_id)
    .bind(&z.zugeschaltet_at)
    .bind(z.lagemonitor)
    .execute(conn)
    .await?;
    Ok(())
}

/// Schaltet ab; `true`, wenn es die Zeile gab.
pub async fn delete(
    conn: &mut SqliteConnection,
    adapter_id: &str,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    let r = sqlx::query("DELETE FROM adapter_einsatz WHERE adapter_id = ? AND einsatz_id = ?")
        .bind(adapter_id)
        .bind(einsatz_id)
        .execute(conn)
        .await?;
    Ok(r.rows_affected() > 0)
}

/// Räumt alle Zuschaltungen eines Einsatzes ab (Abschluss, Spiegel) und nennt die betroffenen
/// Adapter, damit der Aufrufer nach dem Commit den Store nachführt. Ein abgeschlossener Einsatz
/// hält keine Quelle mehr; wird er wieder geöffnet, beginnt er ohne Zuschaltung.
pub async fn delete_for_einsatz(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Vec<String>, AppError> {
    Ok(
        sqlx::query_scalar("DELETE FROM adapter_einsatz WHERE einsatz_id = ? RETURNING adapter_id")
            .bind(einsatz_id)
            .fetch_all(conn)
            .await?,
    )
}

/// Hält ein laufender Einsatz den Adapter?
pub async fn is_active(conn: &mut SqliteConnection, adapter_id: &str) -> Result<bool, AppError> {
    Ok(find_active_holder(conn, adapter_id).await?.is_some())
}
