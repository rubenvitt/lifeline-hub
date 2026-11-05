//! Lesezugang für externe Anzeigen (LLH-1484), etwa den eigenständigen Lagemonitor im FüKW.
//!
//! Herleitung: `/mnt/project-files/llh-1484/design.md` (D1–D3). Ein Lesezugang ist **kein
//! Benutzer und keine Sitzung**: Er öffnet allein `GET /api/lagemonitor/v1/lage`
//! (`routes::lagemonitor_v1`), über den Extractor [`LagemonitorZugriff`], den nur diese Route
//! zieht. Jede andere Route verlangt weiter `CurrentUser`; ein Bearer-Kopf öffnet dort nichts.
//!
//! Welchen Einsatz ein Zugang zeigt, entscheidet die Einsatzleitung über die Freigabe
//! (`lagemonitor_freigabe`, höchstens ein Einsatz je Zugang). Der Abschluss des Einsatzes löscht
//! sie (`einsatz::repo::abschliessen`); gelesen wird zusätzlich nur ein aktiver Einsatz.

use crate::app::AppState;
use crate::error::AppError;
use argon2::password_hash::rand_core::{OsRng, RngCore};
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use base64::Engine;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

/// Längste Bezeichnung eines Zugangs in Zeichen (wie die Gerätebezeichnung).
pub const BEZEICHNUNG_MAX: usize = 60;

/// Präfix jedes Schlüssels: in einer Konfigurationsdatei oder einem Log als Lifeline-Schlüssel
/// erkennbar.
pub const SCHLUESSEL_PRAEFIX: &str = "llh_lm_";

/// Erzeugt einen neuen Schlüssel: 32 Zufallsbytes, base64url ohne Auffüllung.
pub fn neuer_schluessel() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    format!(
        "{SCHLUESSEL_PRAEFIX}{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    )
}

/// SHA-256-Hex eines Schlüssels; nur das steht in der DB.
pub fn hash(schluessel: &str) -> String {
    crate::anhang::repo::sha256_hex(schluessel.as_bytes())
}

/// Ein Lesezugang, wie die Verwaltung ihn sieht. Der Schlüssel steht nie darin.
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct LesezugangAnzeige {
    pub id: i64,
    pub bezeichnung: String,
    /// UTC im SQLite-Format.
    pub angelegt_at: String,
    /// Anzeigename der Person, die ihn angelegt hat; fehlt, wenn ihr Konto gelöscht ist.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub angelegt_von_name: Option<String>,
    /// Letzter Abruf (höchstens minütlich fortgeschrieben); fehlt, solange ihn niemand nutzte.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zuletzt_genutzt_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub widerrufen_at: Option<String>,
    /// Der Einsatz, den der Zugang gerade zeigt; fehlt ohne aktive Freigabe.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatz_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub einsatz_bezeichnung: Option<String>,
}

/// Ein Lesezugang aus Sicht eines Einsatzes (Seite „Geräte“ der Einsatzleitung).
#[derive(Debug, Clone, Serialize, sqlx::FromRow, ToSchema)]
pub struct LesezugangFreigabe {
    pub zugang_id: i64,
    pub bezeichnung: String,
    /// Dieser Einsatz ist für den Zugang freigegeben.
    pub freigegeben: bool,
    /// Der Zugang zeigt gerade einen anderen aktiven Einsatz. Welchen, sagt die Antwort nicht.
    pub anderer_einsatz: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zuletzt_genutzt_at: Option<String>,
}

/// Wirksame Freigaben: nur an aktiven Einsätzen (der Abschluss löscht sie zwar, aber ein Lesen
/// darf nicht an dieser einen Stelle hängen).
const FREIGABE_AKTIV: &str = "SELECT f.zugang_id, f.einsatz_id FROM lagemonitor_freigabe f \
     JOIN einsatz e ON e.id = f.einsatz_id \
     WHERE e.status = 'aktiv' AND e.geloescht_at IS NULL";

/// Alle Zugänge einer Organisation, nicht widerrufene zuerst, dann nach Bezeichnung.
pub async fn liste(pool: &SqlitePool, org_id: i64) -> Result<Vec<LesezugangAnzeige>, AppError> {
    let sql = format!(
        "SELECT z.id, z.bezeichnung, z.angelegt_at, b.anzeigename AS angelegt_von_name, \
                z.zuletzt_genutzt_at, z.widerrufen_at, f.einsatz_id, \
                e.bezeichnung AS einsatz_bezeichnung \
         FROM lagemonitor_zugang z \
         LEFT JOIN benutzer b ON b.id = z.angelegt_von \
         LEFT JOIN ({FREIGABE_AKTIV}) f ON f.zugang_id = z.id AND z.widerrufen_at IS NULL \
         LEFT JOIN einsatz e ON e.id = f.einsatz_id \
         WHERE z.org_id = ? \
         ORDER BY z.widerrufen_at IS NOT NULL, z.bezeichnung COLLATE NOCASE, z.id"
    );
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(org_id)
        .fetch_all(pool)
        .await?)
}

/// Ein Zugang der Organisation; 404, wenn er fremd oder unbekannt ist.
pub async fn laden(
    pool: &SqlitePool,
    org_id: i64,
    zugang_id: i64,
) -> Result<LesezugangAnzeige, AppError> {
    liste(pool, org_id)
        .await?
        .into_iter()
        .find(|z| z.id == zugang_id)
        .ok_or(AppError::NotFound)
}

/// Legt einen Zugang an und liefert seine id.
pub async fn anlegen(
    pool: &SqlitePool,
    org_id: i64,
    bezeichnung: &str,
    schluessel_hash: &str,
    von: i64,
) -> Result<i64, AppError> {
    Ok(sqlx::query_scalar(
        "INSERT INTO lagemonitor_zugang (org_id, bezeichnung, schluessel_hash, angelegt_von) \
         VALUES (?, ?, ?, ?) RETURNING id",
    )
    .bind(org_id)
    .bind(bezeichnung)
    .bind(schluessel_hash)
    .bind(von)
    .fetch_one(pool)
    .await?)
}

/// Widerruft einen Zugang und löst seine Freigabe. `true`, wenn er bis eben gültig war.
pub async fn widerrufen(
    conn: &mut SqliteConnection,
    org_id: i64,
    zugang_id: i64,
    von: i64,
) -> Result<bool, AppError> {
    let wirkung = sqlx::query(
        "UPDATE lagemonitor_zugang SET widerrufen_at = datetime('now'), widerrufen_von = ? \
         WHERE id = ? AND org_id = ? AND widerrufen_at IS NULL",
    )
    .bind(von)
    .bind(zugang_id)
    .bind(org_id)
    .execute(&mut *conn)
    .await?
    .rows_affected()
        == 1;
    if wirkung {
        sqlx::query("DELETE FROM lagemonitor_freigabe WHERE zugang_id = ?")
            .bind(zugang_id)
            .execute(&mut *conn)
            .await?;
    }
    Ok(wirkung)
}

/// Die nicht widerrufenen Zugänge der Organisation aus Sicht eines Einsatzes.
pub async fn freigaben_fuer_einsatz(
    pool: &SqlitePool,
    org_id: i64,
    einsatz_id: i64,
) -> Result<Vec<LesezugangFreigabe>, AppError> {
    let sql = format!(
        "SELECT z.id AS zugang_id, z.bezeichnung, \
                COALESCE(f.einsatz_id = ?, 0) AS freigegeben, \
                COALESCE(f.einsatz_id <> ?, 0) AS anderer_einsatz, \
                z.zuletzt_genutzt_at \
         FROM lagemonitor_zugang z \
         LEFT JOIN ({FREIGABE_AKTIV}) f ON f.zugang_id = z.id \
         WHERE z.org_id = ? AND z.widerrufen_at IS NULL \
         ORDER BY z.bezeichnung COLLATE NOCASE, z.id"
    );
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(sql))
        .bind(einsatz_id)
        .bind(einsatz_id)
        .bind(org_id)
        .fetch_all(pool)
        .await?)
}

/// Bezeichnung eines nicht widerrufenen Zugangs der Organisation; 404 sonst.
pub async fn gueltige_bezeichnung(
    conn: &mut SqliteConnection,
    org_id: i64,
    zugang_id: i64,
) -> Result<String, AppError> {
    sqlx::query_scalar(
        "SELECT bezeichnung FROM lagemonitor_zugang \
         WHERE id = ? AND org_id = ? AND widerrufen_at IS NULL",
    )
    .bind(zugang_id)
    .bind(org_id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(AppError::NotFound)
}

/// Was eine Freigabe bewirkt hat.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FreigabeWirkung {
    /// Der Zugang zeigte diesen Einsatz schon.
    Keine,
    /// Neu freigegeben; vorher zeigte der Zugang keinen aktiven Einsatz.
    Neu,
    /// Neu freigegeben; vorher zeigte er diesen anderen Einsatz.
    Abgeloest { vorher: i64 },
}

/// Gibt den Einsatz für den Zugang frei und ersetzt eine frühere Freigabe.
pub async fn freigeben_tx(
    conn: &mut SqliteConnection,
    zugang_id: i64,
    einsatz_id: i64,
    von: i64,
) -> Result<FreigabeWirkung, AppError> {
    let sql = format!("SELECT einsatz_id FROM ({FREIGABE_AKTIV}) WHERE zugang_id = ?");
    let vorher: Option<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .bind(zugang_id)
        .fetch_optional(&mut *conn)
        .await?;
    if vorher == Some(einsatz_id) {
        return Ok(FreigabeWirkung::Keine);
    }
    sqlx::query(
        "INSERT INTO lagemonitor_freigabe (zugang_id, einsatz_id, freigegeben_von) \
         VALUES (?, ?, ?) \
         ON CONFLICT (zugang_id) DO UPDATE SET einsatz_id = excluded.einsatz_id, \
             freigegeben_von = excluded.freigegeben_von, freigegeben_at = datetime('now')",
    )
    .bind(zugang_id)
    .bind(einsatz_id)
    .bind(von)
    .execute(&mut *conn)
    .await?;
    Ok(match vorher {
        Some(vorher) => FreigabeWirkung::Abgeloest { vorher },
        None => FreigabeWirkung::Neu,
    })
}

/// Beendet die Freigabe des Einsatzes an diesem Zugang. `true`, wenn sie bestand.
pub async fn freigabe_beenden_tx(
    conn: &mut SqliteConnection,
    zugang_id: i64,
    einsatz_id: i64,
) -> Result<bool, AppError> {
    Ok(
        sqlx::query("DELETE FROM lagemonitor_freigabe WHERE zugang_id = ? AND einsatz_id = ?")
            .bind(zugang_id)
            .bind(einsatz_id)
            .execute(&mut *conn)
            .await?
            .rows_affected()
            == 1,
    )
}

/// Löscht alle Freigaben eines Einsatzes (beim Abschluss, in dessen Transaktion).
pub async fn freigaben_loeschen_tx(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM lagemonitor_freigabe WHERE einsatz_id = ?")
        .bind(einsatz_id)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// Der aktive Einsatz, den der Zugang zeigt.
pub async fn freigegebener_einsatz(
    pool: &SqlitePool,
    zugang_id: i64,
) -> Result<Option<i64>, AppError> {
    let sql = format!("SELECT einsatz_id FROM ({FREIGABE_AKTIV}) WHERE zugang_id = ?");
    Ok(sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .bind(zugang_id)
        .fetch_optional(pool)
        .await?)
}

/// Extractor der Schnittstelle für externe Anzeigen: ein gültiger Schlüssel als
/// `Authorization: Bearer …`. Alles andere ist 401, ohne zu sagen, warum (fehlt, falsche Form,
/// unbekannt, widerrufen).
#[derive(Debug, Clone, Copy)]
pub struct LagemonitorZugriff {
    pub zugang_id: i64,
    pub org_id: i64,
}

impl FromRequestParts<AppState> for LagemonitorZugriff {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let schluessel = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::trim)
            .filter(|s| s.starts_with(SCHLUESSEL_PRAEFIX) && s.len() <= 128)
            .ok_or(AppError::Unauthorized)?;
        let (zugang_id, org_id, nutzung_veraltet): (i64, i64, bool) = sqlx::query_as(
            "SELECT id, org_id, \
                    (zuletzt_genutzt_at IS NULL \
                     OR zuletzt_genutzt_at < datetime('now', '-60 seconds')) \
             FROM lagemonitor_zugang \
             WHERE schluessel_hash = ? AND widerrufen_at IS NULL",
        )
        .bind(hash(schluessel))
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::Unauthorized)?;
        // „Zuletzt genutzt“ höchstens minütlich. Geschrieben wird nur, wenn der Stand veraltet
        // ist: auch ein UPDATE ohne Treffer nähme in SQLite die Schreibsperre. Die Bedingung im
        // UPDATE bleibt gegen Rennen zweier Abrufe. Ein Fehler hier lässt den Abruf nicht
        // scheitern.
        if !nutzung_veraltet {
            return Ok(LagemonitorZugriff { zugang_id, org_id });
        }
        if let Err(e) = sqlx::query(
            "UPDATE lagemonitor_zugang SET zuletzt_genutzt_at = datetime('now') \
             WHERE id = ? AND (zuletzt_genutzt_at IS NULL \
                               OR zuletzt_genutzt_at < datetime('now', '-60 seconds'))",
        )
        .bind(zugang_id)
        .execute(&state.pool)
        .await
        {
            tracing::warn!(
                zugang_id,
                "Nutzung des Lagemonitor-Zugangs nicht vermerkt: {e}"
            );
        }
        Ok(LagemonitorZugriff { zugang_id, org_id })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schluessel_tragen_das_praefix_und_sind_verschieden() {
        let a = neuer_schluessel();
        let b = neuer_schluessel();
        assert!(a.starts_with(SCHLUESSEL_PRAEFIX));
        assert_eq!(
            a.len(),
            SCHLUESSEL_PRAEFIX.len() + 43,
            "32 Bytes base64url ohne Auffüllung"
        );
        assert_ne!(a, b);
        assert_ne!(hash(&a), a, "gespeichert wird nur der Hash");
        assert_eq!(hash(&a).len(), 64);
    }
}
