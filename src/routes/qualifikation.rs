use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::personal::qualifikation_repo as repo;
use crate::personal::Qualifikation;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct QualifikationBody {
    pub label: String,
    #[serde(default)]
    pub sortier: i64,
}

fn normalisiere_label(label: &str) -> Result<String, AppError> {
    let l = label.trim().to_string();
    if l.is_empty() {
        return Err(AppError::Validation("Label darf nicht leer sein".into()));
    }
    Ok(l)
}

/// GET /api/qualifikationen — aktive Katalog-Einträge (eigene Org), für die Auswahl.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<Qualifikation>>, AppError> {
    Ok(Json(repo::liste(&state.pool, benutzer.org_id).await?))
}

/// POST /api/qualifikationen — Admin. Dublette label → Conflict.
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(body): Json<QualifikationBody>,
) -> Result<(StatusCode, Json<Qualifikation>), AppError> {
    let label = normalisiere_label(&body.label)?;
    let q = repo::anlegen(&state.pool, benutzer.org_id, &label, body.sortier).await?;
    Ok((StatusCode::CREATED, Json(q)))
}

/// PATCH /api/qualifikationen/{id} — Admin, Vollersatz label/sortier.
pub async fn aktualisieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
    Json(body): Json<QualifikationBody>,
) -> Result<Json<Qualifikation>, AppError> {
    let label = normalisiere_label(&body.label)?;
    let q = repo::aktualisiere(&state.pool, benutzer.org_id, id, &label, body.sortier).await?;
    Ok(Json(q))
}

/// POST /api/qualifikationen/{id}/deaktivieren — Admin (Soft-Delete statt Löschen).
pub async fn deaktivieren(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    repo::deaktivieren(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
