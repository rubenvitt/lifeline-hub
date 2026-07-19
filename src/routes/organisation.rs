use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::extract::JsonBody;
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
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<OrganisationAnzeige>, AppError> {
    // Die EIGENE Organisation (F05/LFH-232), nicht `ORDER BY id LIMIT 1`: sonst sähe ein
    // Nutzer der zweiten Org die Stammdaten der ersten — inkl. `tz_organisation`, das die
    // taktischen Zeichen der gesamten Oberfläche steuert.
    let org = sqlx::query_as::<_, OrganisationAnzeige>(
        "SELECT id, name, tz_organisation FROM organisation WHERE id = ?",
    )
    .bind(benutzer.org_id)
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
    AdminUser(benutzer): AdminUser,
    JsonBody(body): JsonBody<OrgPatch>,
) -> Result<Json<OrganisationAnzeige>, AppError> {
    if !ERLAUBTE_ORG.contains(&body.tz_organisation.as_str()) {
        return Err(AppError::UnprocessableEntity(
            "Unbekannte Organisation".into(),
        ));
    }
    // Der Admin pflegt seine EIGENE Organisation (F05/LFH-232). Er ist zwar serverweit
    // berechtigt, aber „welche Org" darf nicht von der Zeilenreihenfolge abhängen.
    sqlx::query("UPDATE organisation SET tz_organisation = ? WHERE id = ?")
        .bind(&body.tz_organisation)
        .bind(benutzer.org_id)
        .execute(&state.pool)
        .await?;
    let org = sqlx::query_as::<_, OrganisationAnzeige>(
        "SELECT id, name, tz_organisation FROM organisation WHERE id = ?",
    )
    .bind(benutzer.org_id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(org))
}
