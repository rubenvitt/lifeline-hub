//! Soft-Delete (Storno) einer Zeile unter ihrem Elternobjekt.

use crate::error::AppError;
use sqlx::SqliteConnection;

/// Welche Nachweisspalten der Storno neben `storniert_at` mitschreibt.
#[derive(Debug, Clone, Copy)]
pub enum Vermerk {
    Keiner,
    /// `geaendert_at`/`geaendert_von`.
    Geaendert(i64),
    /// Zusätzlich `storniert_von`.
    GeaendertUndStorniert(i64),
}

/// Setzt `storniert_at` genau einmal. Die Bedingung `storniert_at IS NULL` steht im UPDATE
/// selbst, deshalb trifft ein zweiter, auch ein gleichzeitiger Storno keine Zeile mehr: nur
/// einer der beiden schreibt seinen ETB-Nachweis. Fremd → 404; schon storniert → 409 mit
/// `bereits`, ohne `bereits` ebenfalls 404.
pub async fn storniere(
    conn: &mut SqliteConnection,
    tabelle: &'static str,
    eltern_spalte: &'static str,
    eltern_id: i64,
    id: i64,
    vermerk: Vermerk,
    bereits: Option<&str>,
) -> Result<(), AppError> {
    const JETZT: &str = "strftime('%Y-%m-%d %H:%M:%S','now')";
    let nachweis = match vermerk {
        Vermerk::Keiner => String::new(),
        Vermerk::Geaendert(_) => format!(", geaendert_at = {JETZT}, geaendert_von = ?"),
        Vermerk::GeaendertUndStorniert(_) => {
            format!(", storniert_von = ?, geaendert_at = {JETZT}, geaendert_von = ?")
        }
    };
    let sql = format!(
        "UPDATE {tabelle} SET storniert_at = {JETZT}{nachweis} \
         WHERE id = ? AND {eltern_spalte} = ? AND storniert_at IS NULL"
    );
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
    match vermerk {
        Vermerk::Keiner => {}
        Vermerk::Geaendert(von) => query = query.bind(von),
        Vermerk::GeaendertUndStorniert(von) => query = query.bind(von).bind(von),
    }
    let betroffen = query
        .bind(id)
        .bind(eltern_id)
        .execute(&mut *conn)
        .await?
        .rows_affected();
    if betroffen > 0 {
        return Ok(());
    }
    let Some(bereits) = bereits else {
        return Err(AppError::NotFound);
    };
    let existiert: Option<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT 1 FROM {tabelle} WHERE id = ? AND {eltern_spalte} = ?"
    )))
    .bind(id)
    .bind(eltern_id)
    .fetch_optional(&mut *conn)
    .await?;
    match existiert {
        None => Err(AppError::NotFound),
        Some(_) => Err(AppError::Conflict(bereits.into())),
    }
}
