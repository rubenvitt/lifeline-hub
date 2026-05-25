use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::stichwort::{self, StichwortVorschlag};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// GET /api/stichwort-vorschlaege — Vorschläge der eigenen Organisation.
/// Für alle eingeloggten Nutzer (Combobox).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<StichwortVorschlag>>, AppError> {
    Ok(Json(stichwort::liste(&state.pool, benutzer.org_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct NeuerVorschlag {
    pub text: String,
}

/// POST /api/stichwort-vorschlaege — Vorschlag anlegen. Admin-only.
/// Duplikat je Organisation → Conflict (409).
pub async fn anlegen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Json(req): Json<NeuerVorschlag>,
) -> Result<(StatusCode, Json<StichwortVorschlag>), AppError> {
    let text = req.text.trim();
    if text.is_empty() {
        return Err(AppError::Validation("Stichwort darf nicht leer sein".into()));
    }
    let vorschlag = stichwort::anlegen(&state.pool, benutzer.org_id, text).await?;
    Ok((StatusCode::CREATED, Json(vorschlag)))
}

/// DELETE /api/stichwort-vorschlaege/{id} — Vorschlag löschen. Admin-only.
pub async fn loeschen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    Path(id): Path<i64>,
) -> Result<StatusCode, AppError> {
    stichwort::loeschen(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
