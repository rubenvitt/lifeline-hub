//! Helfer-Einladung (Spec `docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md`,
//! „Ablauf“, Schritt 1, und „Server“): der Einsatz-QR. Ein Code wie bei der Gerätekopplung
//! (`geraet::code`, Crockford-Base32, nur als SHA-256 gespeichert), aber mehrfach einlösbar.
//!
//! - Höchstens eine gültige Einladung je Einsatz: eine neue widerruft die alte in derselben
//!   Transaktion ([`anlegen`]).
//! - Die Gültigkeit begrenzt nur, wie lange man sich anmelden kann, nicht wie lange eine Anmeldung
//!   gilt. Vorgabe [`VORGABE_MINUTEN`], höchstens [`HOECHSTENS_MINUTEN`]. Ein geplantes Ende kennt
//!   der Einsatz nicht; mit seinem Abschluss endet die Einladung über die Prüfung „Einsatz aktiv“
//!   in [`einladung_einloesen`].

use crate::error::AppError;
use crate::geraet::code;
use serde::Serialize;
use sqlx::{SqliteConnection, SqlitePool};
use utoipa::ToSchema;

/// Vorgabe der Gültigkeit einer Einladung (4 h).
pub const VORGABE_MINUTEN: i64 = 240;
/// Höchste Gültigkeit einer Einladung (72 h).
pub const HOECHSTENS_MINUTEN: i64 = 72 * 60;

/// Eine Helfer-Einladung. Den Klartext-`code` trägt nur die Antwort auf das Anlegen, einmal.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct HelferEinladungAnzeige {
    pub id: i64,
    /// Der Code (8 Zeichen); fehlt außer in der Antwort auf das Anlegen.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// `https://<server>/helfer#<CODE>`, wenn der Server seine öffentliche Adresse kennt; sonst
    /// baut der Client die Adresse aus seinem Origin (`helferAdresse`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub expires_at: String,
}

/// Prüft die gewünschte Gültigkeit in Minuten (422 außerhalb von 1 bis [`HOECHSTENS_MINUTEN`]).
pub fn pruefe_minuten(minuten: Option<i64>) -> Result<i64, AppError> {
    let minuten = minuten.unwrap_or(VORGABE_MINUTEN);
    if !(1..=HOECHSTENS_MINUTEN).contains(&minuten) {
        return Err(AppError::UnprocessableEntity(format!(
            "Eine Einladung gilt mindestens eine Minute und höchstens {} Stunden",
            HOECHSTENS_MINUTEN / 60
        )));
    }
    Ok(minuten)
}

/// Legt eine neue Einladung an und widerruft eine noch gültige alte desselben Einsatzes.
/// Liefert die Anzeige mit Code (ohne `url`).
pub async fn anlegen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    minuten: i64,
    von: i64,
) -> Result<HelferEinladungAnzeige, AppError> {
    sqlx::query(
        "UPDATE helfer_einladung SET widerrufen_at = datetime('now') \
         WHERE einsatz_id = ? AND widerrufen_at IS NULL AND laeuft_ab_at > datetime('now')",
    )
    .bind(einsatz_id)
    .execute(&mut *conn)
    .await?;
    let code = code::neu();
    let (id, expires_at): (i64, String) = sqlx::query_as(
        "INSERT INTO helfer_einladung (einsatz_id, code_hash, laeuft_ab_at, erstellt_von, erstellt_at) \
         VALUES (?, ?, datetime('now', ?), ?, datetime('now')) \
         RETURNING id, laeuft_ab_at",
    )
    .bind(einsatz_id)
    .bind(code::hash(&code))
    .bind(format!("+{minuten} minutes"))
    .bind(von)
    .fetch_one(&mut *conn)
    .await?;
    Ok(HelferEinladungAnzeige {
        id,
        code: Some(code),
        url: None,
        expires_at,
    })
}

/// Widerruft eine Einladung. Eine Einladung eines anderen Einsatzes ist 404; eine schon
/// widerrufene bleibt, wie sie ist.
pub async fn widerrufen(
    conn: &mut SqliteConnection,
    einsatz_id: i64,
    einladung_id: i64,
) -> Result<(), AppError> {
    let gefunden: Option<i64> =
        sqlx::query_scalar("SELECT id FROM helfer_einladung WHERE id = ? AND einsatz_id = ?")
            .bind(einladung_id)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
    gefunden.ok_or(AppError::NotFound)?;
    sqlx::query(
        "UPDATE helfer_einladung SET widerrufen_at = datetime('now') \
         WHERE id = ? AND widerrufen_at IS NULL",
    )
    .bind(einladung_id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Die gültige Einladung des Einsatzes, ohne Code.
pub async fn gueltige(
    pool: &SqlitePool,
    einsatz_id: i64,
) -> Result<Option<HelferEinladungAnzeige>, AppError> {
    let zeile: Option<(i64, String)> = sqlx::query_as(
        "SELECT id, laeuft_ab_at FROM helfer_einladung \
         WHERE einsatz_id = ? AND widerrufen_at IS NULL AND laeuft_ab_at > datetime('now') \
         ORDER BY id DESC LIMIT 1",
    )
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?;
    Ok(zeile.map(|(id, expires_at)| HelferEinladungAnzeige {
        id,
        code: None,
        url: None,
        expires_at,
    }))
}

/// Löst einen Einladungscode ein und zählt `einloesungen` hoch. Liefert
/// `(einladung_id, einsatz_id, org_id)`. Ein unbekannter, abgelaufener oder widerrufener Code und
/// ein nicht mehr aktiver Einsatz sind einheitlich 401, damit die Antwort nichts verrät; ebenso
/// eine Eingabe, die nicht die Form eines Codes hat.
pub async fn einladung_einloesen(
    conn: &mut SqliteConnection,
    code: &str,
) -> Result<(i64, i64, i64), AppError> {
    let code = code::normalisiere(code).ok_or(AppError::Unauthorized)?;
    let treffer: Option<(i64, i64, i64)> = sqlx::query_as(
        "UPDATE helfer_einladung SET einloesungen = einloesungen + 1 \
         WHERE code_hash = ? AND widerrufen_at IS NULL AND laeuft_ab_at > datetime('now') \
           AND EXISTS (SELECT 1 FROM einsatz e WHERE e.id = helfer_einladung.einsatz_id \
                       AND e.status = 'aktiv' AND e.geloescht_at IS NULL) \
         RETURNING id, einsatz_id, \
                   (SELECT e.org_id FROM einsatz e WHERE e.id = helfer_einladung.einsatz_id)",
    )
    .bind(code::hash(&code))
    .fetch_optional(&mut *conn)
    .await?;
    treffer.ok_or(AppError::Unauthorized)
}
