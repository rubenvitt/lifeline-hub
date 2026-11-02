//! Overrides der Richtwerte je Organisation und je Einsatz (LLH-1520, design.md D2).
//!
//! Gespeichert sind nur gesetzte Werte; `None` beim Setzen löscht die Zeile, der Schlüssel erbt
//! dann wieder. Schlüssel und Grenzen prüft der Aufrufer vorher (`super::pruefe`).

use std::collections::HashMap;

use sqlx::SqliteConnection;

use crate::error::AppError;

/// Die gesetzten Werte einer Organisation.
pub async fn org_werte(
    conn: &mut SqliteConnection,
    org_id: i64,
) -> Result<HashMap<String, f64>, AppError> {
    let zeilen: Vec<(String, f64)> =
        sqlx::query_as("SELECT schluessel, wert FROM org_unterkunft_richtwert WHERE org_id = ?")
            .bind(org_id)
            .fetch_all(&mut *conn)
            .await?;
    Ok(zeilen.into_iter().collect())
}

/// Die gesetzten Werte eines Einsatzes.
pub async fn einsatz_werte(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<HashMap<String, f64>, AppError> {
    let zeilen: Vec<(String, f64)> = sqlx::query_as(
        "SELECT schluessel, wert FROM einsatz_unterkunft_richtwert WHERE einsatz_id = ?",
    )
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    Ok(zeilen.into_iter().collect())
}

/// Setzt (`Some`) oder löscht (`None`) den Wert einer Organisation.
pub async fn org_setzen(
    conn: &mut SqliteConnection,
    org_id: i64,
    schluessel: &str,
    wert: Option<f64>,
    benutzer_id: i64,
) -> Result<(), AppError> {
    match wert {
        Some(w) => {
            sqlx::query(
                "INSERT INTO org_unterkunft_richtwert \
                    (org_id, schluessel, wert, geaendert_at, geaendert_von) \
                 VALUES (?1, ?2, ?3, datetime('now'), ?4) \
                 ON CONFLICT(org_id, schluessel) DO UPDATE SET \
                    wert = excluded.wert, \
                    geaendert_at = excluded.geaendert_at, \
                    geaendert_von = excluded.geaendert_von",
            )
            .bind(org_id)
            .bind(schluessel)
            .bind(w)
            .bind(benutzer_id)
            .execute(&mut *conn)
            .await?;
        }
        None => {
            sqlx::query("DELETE FROM org_unterkunft_richtwert WHERE org_id = ? AND schluessel = ?")
                .bind(org_id)
                .bind(schluessel)
                .execute(&mut *conn)
                .await?;
        }
    }
    Ok(())
}

/// Setzt (`Some`) oder löscht (`None`) den Wert eines Einsatzes.
pub async fn einsatz_setzen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    schluessel: &str,
    wert: Option<f64>,
    benutzer_id: i64,
) -> Result<(), AppError> {
    match wert {
        Some(w) => {
            sqlx::query(
                "INSERT INTO einsatz_unterkunft_richtwert \
                    (einsatz_id, schluessel, wert, geaendert_at, geaendert_von) \
                 VALUES (?1, ?2, ?3, datetime('now'), ?4) \
                 ON CONFLICT(einsatz_id, schluessel) DO UPDATE SET \
                    wert = excluded.wert, \
                    geaendert_at = excluded.geaendert_at, \
                    geaendert_von = excluded.geaendert_von",
            )
            .bind(einsatz_id)
            .bind(schluessel)
            .bind(w)
            .bind(benutzer_id)
            .execute(&mut *conn)
            .await?;
        }
        None => {
            sqlx::query(
                "DELETE FROM einsatz_unterkunft_richtwert WHERE einsatz_id = ? AND schluessel = ?",
            )
            .bind(einsatz_id)
            .bind(schluessel)
            .execute(&mut *conn)
            .await?;
        }
    }
    Ok(())
}
