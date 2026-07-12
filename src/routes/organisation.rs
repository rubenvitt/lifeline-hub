use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Org-Stammdaten inkl. DV-102-Org-Default (`tz_organisation`).
#[derive(Debug, Serialize, sqlx::FromRow, ToSchema)]
pub struct OrganisationAnzeige {
    pub id: i64,
    pub name: String,
    pub tz_organisation: Option<String>,
}

/// GET /api/organisation — Org-Stammdaten inkl. DV-102-Org-Default.
/// Jeder eingeloggte Nutzer.
pub async fn lesen(
    State(state): State<AppState>,
    CurrentUser(_benutzer): CurrentUser,
) -> Result<Json<OrganisationAnzeige>, AppError> {
    let org = sqlx::query_as::<_, OrganisationAnzeige>(
        "SELECT id, name, tz_organisation FROM organisation ORDER BY id LIMIT 1",
    )
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(org))
}

#[derive(Debug, Deserialize)]
pub struct OrgPatch {
    pub tz_organisation: String,
}

/// Erlaubte DV-102-Organisationsschlüssel (taktische-zeichen-core).
const ERLAUBTE_ORG: &[&str] = &[
    "feuerwehr",
    "thw",
    "fuehrung",
    "polizei",
    "gefahrenabwehr",
    "hilfsorganisation",
    "bundeswehr",
    "zivil",
];

/// PATCH /api/organisation — Org-Default setzen. Nur Admin.
pub async fn aktualisieren(
    State(state): State<AppState>,
    _admin: AdminUser,
    Json(body): Json<OrgPatch>,
) -> Result<Json<OrganisationAnzeige>, AppError> {
    if !ERLAUBTE_ORG.contains(&body.tz_organisation.as_str()) {
        return Err(AppError::UnprocessableEntity(
            "Unbekannte Organisation".into(),
        ));
    }
    sqlx::query(
        "UPDATE organisation SET tz_organisation = ? \
         WHERE id = (SELECT id FROM organisation ORDER BY id LIMIT 1)",
    )
    .bind(&body.tz_organisation)
    .execute(&state.pool)
    .await?;
    let org = sqlx::query_as::<_, OrganisationAnzeige>(
        "SELECT id, name, tz_organisation FROM organisation ORDER BY id LIMIT 1",
    )
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(org))
}
