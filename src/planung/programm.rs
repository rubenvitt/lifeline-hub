//! Programmpunkte der Planung (LLH-1583, Spec `vorplanung`, „Programmpunkte der Planung“): das
//! Programm der Veranstaltung schon vor dem Einsatz, etwa „Einlass“ 18:00 oder „Feuerwerk“ 22:30.
//! Die Übernahme legt sie im Einsatz als Programmpunkte an (`programmpunkt`, LLH-1570).
//!
//! Dieselben Grenzen wie am Einsatz: Bezeichnung höchstens
//! [`PROGRAMMPUNKT_BEZEICHNUNG_MAX`](crate::programmpunkt::PROGRAMMPUNKT_BEZEICHNUNG_MAX) Zeichen,
//! höchstens [`PROGRAMMPUNKTE_MAX`] je Planung. Der Zeitpunkt darf außerhalb des Zeitraums der
//! Planung liegen (der Aufbau am Vortag), wie ein Block. Jeder Schreibweg prüft in seiner
//! Transaktion, dass die Planung nicht übernommen ist (409). Kein ETB: es gibt keinen Einsatz.

use sqlx::{SqliteConnection, SqlitePool};

use crate::abloesung::schichtplan::uebernahme::PaketProgrammpunkt;
use crate::error::AppError;
use crate::programmpunkt::{Programmpunkt, PROGRAMMPUNKTE_MAX};
use crate::write_retry;

/// Alle Programmpunkte der Planung nach Zeitpunkt.
pub(crate) async fn liste_tx(
    conn: &mut SqliteConnection,
    planung_id: i64,
) -> Result<Vec<Programmpunkt>, AppError> {
    Ok(sqlx::query_as::<_, Programmpunkt>(
        "SELECT id, bezeichnung, zeitpunkt_at FROM planung_programmpunkt \
         WHERE planung_id = ? ORDER BY zeitpunkt_at, id",
    )
    .bind(planung_id)
    .fetch_all(&mut *conn)
    .await?)
}

/// Die Programmpunkte der Planung, wie die Übernahme sie in den Einsatz bringt.
pub(crate) async fn paket_tx(
    conn: &mut SqliteConnection,
    planung_id: i64,
) -> Result<Vec<PaketProgrammpunkt>, AppError> {
    Ok(liste_tx(conn, planung_id)
        .await?
        .into_iter()
        .map(|p| PaketProgrammpunkt {
            bezeichnung: p.bezeichnung,
            zeitpunkt_at: p.zeitpunkt_at,
        })
        .collect())
}

/// Legt einen Programmpunkt an. Fremd oder unbekannt 404, übernommen 409, voll 422.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    planung_id: i64,
    benutzer_id: i64,
    bezeichnung: &str,
    zeitpunkt_at: &str,
) -> Result<Programmpunkt, AppError> {
    write_retry!(pool, |conn| {
        anlegen_tx(
            conn,
            org_id,
            planung_id,
            benutzer_id,
            bezeichnung,
            zeitpunkt_at,
        )
        .await
    })
}

/// [`anlegen`] in einer offenen Transaktion (auch für die Demo-Planung).
pub async fn anlegen_tx(
    conn: &mut SqliteConnection,
    org_id: i64,
    planung_id: i64,
    benutzer_id: i64,
    bezeichnung: &str,
    zeitpunkt_at: &str,
) -> Result<Programmpunkt, AppError> {
    super::repo::schreibbar_tx(conn, org_id, planung_id).await?;
    let bisher: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM planung_programmpunkt WHERE planung_id = ?")
            .bind(planung_id)
            .fetch_one(&mut *conn)
            .await?;
    if bisher >= PROGRAMMPUNKTE_MAX {
        return Err(AppError::UnprocessableEntity(format!(
            "Eine Planung hat höchstens {PROGRAMMPUNKTE_MAX} Programmpunkte"
        )));
    }
    Ok(sqlx::query_as::<_, Programmpunkt>(
        "INSERT INTO planung_programmpunkt (planung_id, bezeichnung, zeitpunkt_at, angelegt_von) \
         VALUES (?, ?, ?, ?) RETURNING id, bezeichnung, zeitpunkt_at",
    )
    .bind(planung_id)
    .bind(bezeichnung)
    .bind(zeitpunkt_at)
    .bind(benutzer_id)
    .fetch_one(&mut *conn)
    .await?)
}

/// Ändert Bezeichnung und/oder Zeitpunkt; `None` lässt das Feld stehen. Unbekannt 404,
/// übernommen 409.
pub async fn aendern(
    pool: &SqlitePool,
    org_id: i64,
    planung_id: i64,
    id: i64,
    bezeichnung: Option<&str>,
    zeitpunkt_at: Option<&str>,
) -> Result<Programmpunkt, AppError> {
    write_retry!(pool, |conn| {
        super::repo::schreibbar_tx(conn, org_id, planung_id).await?;
        sqlx::query_as::<_, Programmpunkt>(
            "UPDATE planung_programmpunkt SET \
               bezeichnung = COALESCE(?, bezeichnung), \
               zeitpunkt_at = COALESCE(?, zeitpunkt_at), \
               geaendert_at = datetime('now') \
             WHERE id = ? AND planung_id = ? \
             RETURNING id, bezeichnung, zeitpunkt_at",
        )
        .bind(bezeichnung)
        .bind(zeitpunkt_at)
        .bind(id)
        .bind(planung_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)
    })
}

/// Löscht einen Programmpunkt. Unbekannt 404, übernommen 409.
pub async fn loeschen(
    pool: &SqlitePool,
    org_id: i64,
    planung_id: i64,
    id: i64,
) -> Result<(), AppError> {
    write_retry!(pool, |conn| {
        super::repo::schreibbar_tx(conn, org_id, planung_id).await?;
        let geloescht =
            sqlx::query("DELETE FROM planung_programmpunkt WHERE id = ? AND planung_id = ?")
                .bind(id)
                .bind(planung_id)
                .execute(&mut *conn)
                .await?
                .rows_affected();
        if geloescht == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    })
}
