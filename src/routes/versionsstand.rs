//! HTTP-Routen für den Versionsstand der Instanz (Spec `versionsstand`).
//!
//! GET  /api/versionsstand          — laufende Version, Vorgänger, Lesestand.
//! POST /api/versionsstand/gelesen  — markiert die laufende Version als gelesen.
//!
//! Beide verlangen eine Sitzung (`CurrentUser`); anonym gibt es nichts zu lesen und nichts zu
//! ändern. Der Lesestand gilt für die ganze Instanz, nicht für die Person.

use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::error::AppError;
use crate::versionsstand::{nach_start, repo, VersionsstandAnzeige};
use axum::extract::State;
use axum::Json;

/// Die Version, die dieser Server trägt. Dieselbe Quelle wie beim Start (`main.rs`).
pub const LAUFENDE_VERSION: &str = env!("CARGO_PKG_VERSION");

/// GET /api/versionsstand — ohne Zeile (nur in Tests vor dem Start denkbar) antwortet die Route
/// mit dem Stand, den der Start schriebe, ohne ihn zu speichern.
pub async fn lesen(
    State(state): State<AppState>,
    CurrentUser(_benutzer): CurrentUser,
) -> Result<Json<VersionsstandAnzeige>, AppError> {
    let stand = match repo::laden(&state.pool).await? {
        Some(stand) => stand,
        None => nach_start(None, LAUFENDE_VERSION),
    };
    Ok(Json(stand.into()))
}

/// POST /api/versionsstand/gelesen — setzt `gelesen_bis` auf die laufende Version.
pub async fn gelesen(
    State(state): State<AppState>,
    CurrentUser(_benutzer): CurrentUser,
) -> Result<Json<VersionsstandAnzeige>, AppError> {
    let stand = repo::als_gelesen_markieren(&state.pool, LAUFENDE_VERSION).await?;
    Ok(Json(stand.into()))
}
