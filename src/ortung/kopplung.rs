//! Kopplung eines Einsatzfahrzeugs an eine Ortungs-Kennung (LLH-2091, Entwurf „Koppeln und
//! Trennen“). Alle `_tx`-Funktionen laufen in der Schreibtransaktion des Aufrufers; ETB und Live
//! macht der Aufrufer.

use crate::error::AppError;
use crate::public_api::scope::Scope;
use sqlx::{SqliteConnection, SqlitePool};

/// Eine Kopplung mit dem Namen ihres Zugangs.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct Kopplung {
    pub einsatz_fahrzeug_id: i64,
    pub einsatz_id: i64,
    pub zugang_id: String,
    pub zugang_name: String,
    pub kennung: String,
    pub ehrenamt_bestaetigt: bool,
    pub gekoppelt_at: String,
}

/// Eine Kennung der letzten 24 Stunden. Bewusst ohne Koordinaten.
#[derive(Debug, Clone, PartialEq, Eq, sqlx::FromRow)]
pub struct Kandidat {
    pub zugang_id: String,
    pub zugang_name: String,
    pub kennung: String,
    pub empfangen_at: String,
    pub gekoppelt: bool,
}

const SELECT_KOPPLUNG: &str = "SELECT k.einsatz_fahrzeug_id, k.einsatz_id, k.zugang_id, \
        z.name AS zugang_name, k.kennung, k.ehrenamt_bestaetigt, k.gekoppelt_at \
     FROM ortung_kopplung k JOIN einwurf_zugang z ON z.id = k.zugang_id";

/// Die Kopplung des Einsatzfahrzeugs, wenn es eine hat.
pub async fn load_kopplung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
) -> Result<Option<Kopplung>, AppError> {
    Ok(sqlx::query_as::<_, Kopplung>(sqlx::AssertSqlSafe(format!(
        "{SELECT_KOPPLUNG} WHERE k.einsatz_fahrzeug_id = ? AND k.einsatz_id = ?"
    )))
    .bind(ef_id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?)
}

/// Koppelt das Fahrzeug an die Kennung; eine vorhandene Kopplung desselben Fahrzeugs wird
/// ersetzt. 409 bei beendetem Fahrzeug, nicht aktivem oder gespiegeltem Einsatz und bei einer
/// Kennung, die schon an einem anderen Fahrzeug hängt; 422 bei fremdem, widerrufenem oder
/// falschem Zugang.
#[allow(clippy::too_many_arguments)]
pub async fn create_kopplung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
    zugang_id: &str,
    kennung: &str,
    ehrenamt_bestaetigt: bool,
    benutzer_id: i64,
    jetzt: &str,
) -> Result<Kopplung, AppError> {
    let einsatz: Option<(i64, String, bool)> =
        sqlx::query_as("SELECT org_id, status, spiegel != 0 FROM einsatz WHERE id = ?")
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
    let (org_id, status, spiegel) = einsatz.ok_or(AppError::NotFound)?;
    if spiegel {
        return Err(AppError::Conflict(
            "Dieser Einsatz ist ein Spiegel; Ortung lässt sich dort nicht koppeln".into(),
        ));
    }
    if status != "aktiv" {
        return Err(AppError::Conflict("Der Einsatz ist nicht aktiv".into()));
    }
    crate::fahrzeug::disposition_repo::require_aktiv_tx(conn, einsatz_id, ef_id).await?;

    let zugang: Option<(String, Option<String>)> = sqlx::query_as(
        "SELECT scope, widerrufen_at FROM einwurf_zugang WHERE id = ? AND org_id = ?",
    )
    .bind(zugang_id)
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?;
    match zugang {
        Some((scope, None)) if scope == Scope::PositionenWrite.as_str() => {}
        _ => {
            return Err(AppError::UnprocessableEntity(
                "Der Zugang ist unbekannt, widerrufen oder nicht für Positionen eingerichtet"
                    .into(),
            ))
        }
    }

    let belegt: Option<i64> = sqlx::query_scalar(
        "SELECT einsatz_fahrzeug_id FROM ortung_kopplung \
         WHERE zugang_id = ? AND kennung = ? AND einsatz_fahrzeug_id != ?",
    )
    .bind(zugang_id)
    .bind(kennung)
    .bind(ef_id)
    .fetch_optional(&mut *conn)
    .await?;
    if belegt.is_some() {
        return Err(AppError::Conflict(
            "Die Kennung ist schon an ein anderes Fahrzeug gekoppelt".into(),
        ));
    }

    sqlx::query("DELETE FROM ortung_kopplung WHERE einsatz_fahrzeug_id = ?")
        .bind(ef_id)
        .execute(&mut *conn)
        .await?;
    sqlx::query(
        "INSERT INTO ortung_kopplung (einsatz_fahrzeug_id, einsatz_id, org_id, zugang_id, \
         kennung, ehrenamt_bestaetigt, gekoppelt_at, gekoppelt_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(ef_id)
    .bind(einsatz_id)
    .bind(org_id)
    .bind(zugang_id)
    .bind(kennung)
    .bind(ehrenamt_bestaetigt)
    .bind(jetzt)
    .bind(benutzer_id)
    .execute(&mut *conn)
    .await?;
    load_kopplung_tx(conn, einsatz_id, ef_id)
        .await?
        .ok_or(AppError::NotFound)
}

/// Löscht die Kopplung des Fahrzeugs und liefert die gelöschte; `None`, wenn es keine gab.
pub async fn delete_kopplung_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    ef_id: i64,
) -> Result<Option<Kopplung>, AppError> {
    let alt = load_kopplung_tx(conn, einsatz_id, ef_id).await?;
    if alt.is_some() {
        sqlx::query("DELETE FROM ortung_kopplung WHERE einsatz_fahrzeug_id = ? AND einsatz_id = ?")
            .bind(ef_id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?;
    }
    Ok(alt)
}

/// Löscht alle Kopplungen des Einsatzes (Abschluss) und liefert sie mit der Fahrzeug-ID.
pub async fn delete_kopplungen_einsatz_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<Vec<(i64, Kopplung)>, AppError> {
    let alle = sqlx::query_as::<_, Kopplung>(sqlx::AssertSqlSafe(format!(
        "{SELECT_KOPPLUNG} WHERE k.einsatz_id = ? ORDER BY k.einsatz_fahrzeug_id"
    )))
    .bind(einsatz_id)
    .fetch_all(&mut *conn)
    .await?;
    sqlx::query("DELETE FROM ortung_kopplung WHERE einsatz_id = ?")
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    Ok(alle
        .into_iter()
        .map(|k| (k.einsatz_fahrzeug_id, k))
        .collect())
}

/// Kennungen der letzten 24 Stunden aus den nicht widerrufenen Zugängen der Org mit
/// `positionen:write`; jüngste zuerst. `jetzt` im Format [`crate::zeit::FORMAT`].
pub async fn list_kandidaten(
    pool: &SqlitePool,
    org_id: i64,
    jetzt: &str,
) -> Result<Vec<Kandidat>, AppError> {
    Ok(sqlx::query_as::<_, Kandidat>(
        "SELECT p.zugang_id, z.name AS zugang_name, p.kennung, p.empfangen_at, \
                EXISTS (SELECT 1 FROM ortung_kopplung k \
                        WHERE k.zugang_id = p.zugang_id AND k.kennung = p.kennung) AS gekoppelt \
         FROM position_letzte p JOIN einwurf_zugang z ON z.id = p.zugang_id \
         WHERE z.org_id = ? AND z.scope = ? AND z.widerrufen_at IS NULL \
           AND p.empfangen_at >= datetime(?, '-24 hours') \
         ORDER BY p.empfangen_at DESC, z.name, p.kennung",
    )
    .bind(org_id)
    .bind(Scope::PositionenWrite.as_str())
    .bind(jetzt)
    .fetch_all(pool)
    .await?)
}
