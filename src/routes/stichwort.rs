use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::extract::JsonBody;
use crate::extract::PfadParam;
use crate::routes::support::pflicht;
use crate::stichwort::{self, StichwortVorschlag};
use axum::extract::State;
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
    JsonBody(req): JsonBody<NeuerVorschlag>,
) -> Result<(StatusCode, Json<StichwortVorschlag>), AppError> {
    let text = pflicht(&req.text, "Stichwort")?;
    let vorschlag = stichwort::anlegen(&state.pool, benutzer.org_id, &text).await?;
    Ok((StatusCode::CREATED, Json(vorschlag)))
}

/// DELETE /api/stichwort-vorschlaege/{id} — Vorschlag löschen. Admin-only.
pub async fn loeschen(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
) -> Result<StatusCode, AppError> {
    stichwort::loeschen(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize)]
pub struct VorlageKopplung {
    /// Einsatz-Vorlage derselben Organisation; `null` löst die Kopplung. Pflichtfeld, damit ein
    /// leerer Body nicht still entkoppelt.
    #[serde(
        default,
        deserialize_with = "crate::routes::support::deserialize_optional_field"
    )]
    pub vorlage_id: Option<Option<i64>>,
}

/// PUT /api/stichwort-vorschlaege/{id}/vorlage — Vorschlag an eine Einsatz-Vorlage koppeln
/// (LLH-1375). Admin-only. Fremder oder unbekannter Vorschlag 404, Vorlage einer anderen
/// Organisation oder unbekannt 400, Feld fehlt 400.
pub async fn set_vorlage(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(req): JsonBody<VorlageKopplung>,
) -> Result<Json<StichwortVorschlag>, AppError> {
    let vorlage_id = req
        .vorlage_id
        .ok_or_else(|| AppError::Validation("vorlage_id fehlt".into()))?;
    Ok(Json(
        stichwort::set_vorlage(&state.pool, benutzer.org_id, id, vorlage_id).await?,
    ))
}
