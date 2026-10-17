//! Katalog „Schichtmodelle“ (LLH-1122, Spec `openspec/specs/kraefte-abloesung/spec.md`,
//! „Schichtmodelle der Organisation“). Lesen: jeder Angemeldete der Organisation (die
//! Einsatz-Einstellungen wählen daraus); Schreiben: Admin.
//!
//! Statuscodes (`src/AGENTS.md`, „Statuscode-Konvention“): 400 für das Feld allein (leere oder
//! zu lange Bezeichnung, unbekannter Typ, Zahl außerhalb, unlesbare Uhrzeit, fehlender Wert des
//! Typs; `schichtmodell::WerteBody::pruefen`), 422 für ein Feld des anderen Typs, 409 für eine
//! gleiche Bezeichnung oder eine zweite Vorgabe, 404 für ein fremdes Modell. `stammdaten`
//! meldet die Middleware `routes::live::stammdaten_live` (Präfix in `STAMMDATEN_PFADE`).

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::schichtmodell::{repo, Schichtmodell, WerteBody};

/// GET /api/schichtmodelle — die Modelle der eigenen Organisation, die Vorgabe zuerst.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<Schichtmodell>>, AppError> {
    Ok(Json(repo::list(&state.pool, benutzer.org_id).await?))
}

/// Body zum Anlegen und Ändern: die Werte des Modells und, ob es die Vorgabe der Organisation
/// ist (fehlt = nein).
#[derive(Debug, Deserialize)]
pub struct SchichtmodellBody {
    #[serde(flatten)]
    pub werte: WerteBody,
    #[serde(default)]
    pub ist_vorgabe: bool,
}

/// POST /api/schichtmodelle — Admin.
pub async fn create(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    JsonBody(body): JsonBody<SchichtmodellBody>,
) -> Result<(StatusCode, Json<Schichtmodell>), AppError> {
    let werte = body.werte.check()?;
    Ok((
        StatusCode::CREATED,
        Json(repo::create(&state.pool, benutzer.org_id, &werte, body.ist_vorgabe).await?),
    ))
}

/// PUT /api/schichtmodelle/{sid} — Admin, ersetzt den ganzen Satz. Einsätze behalten ihre
/// Kopie.
pub async fn update(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<SchichtmodellBody>,
) -> Result<Json<Schichtmodell>, AppError> {
    let werte = body.werte.check()?;
    Ok(Json(
        repo::update(&state.pool, benutzer.org_id, id, &werte, body.ist_vorgabe).await?,
    ))
}

/// DELETE /api/schichtmodelle/{sid} — Admin. Einsätze behalten ihre Kopie.
pub async fn delete(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
) -> Result<StatusCode, AppError> {
    repo::delete(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
