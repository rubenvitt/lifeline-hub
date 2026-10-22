//! Katalog „Einsatz-Vorlagen“ (LLH-1375, Spec `openspec/specs/einsatz-vorlagen`). Lesen: jeder
//! Angemeldete der Organisation (Anlegedialog); Schreiben: System-Admin. Fremde oder unbekannte
//! id → 404. `stammdaten` meldet die Middleware `routes::live::stammdaten_live` (Präfix in
//! `STAMMDATEN_PFADE`).

use crate::app::AppState;
use crate::auth::session::{AdminUser, CurrentUser};
use crate::einsatz::Einsatzart;
use crate::einsatz_vorlage::repo::{self, VorlageDaten};
use crate::einsatz_vorlage::{normalize_ausgeblendet, EinsatzVorlage, BEZEICHNUNG_MAX};
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::routes::support::pflicht_max;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// GET /api/einsatz-vorlagen — Vorlagen der eigenen Organisation, geordnet nach `sortier`.
pub async fn list(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<EinsatzVorlage>>, AppError> {
    Ok(Json(repo::list(&state.pool, benutzer.org_id).await?))
}

/// Body von POST und PUT (Vollersatz). `ausgeblendet` sind die Modulschlüssel, die ein mit der
/// Vorlage angelegter Einsatz ausblendet; Pflichtfeld (leer = blendet nichts aus), damit ein
/// Vollersatz ohne das Feld die Menge nicht still leert.
#[derive(Debug, Deserialize)]
pub struct EinsatzVorlageEingabe {
    pub bezeichnung: String,
    pub einsatzart: Option<String>,
    pub ausgeblendet: Vec<String>,
}

/// Feldprüfung (alles 400): Bezeichnung getrimmt nicht leer und in der Grenze, Einsatzart
/// bekannt (leer = keine), Modulschlüssel bekannt und ausblendbar.
fn check_eingabe(
    body: &EinsatzVorlageEingabe,
) -> Result<(String, Option<Einsatzart>, Vec<&'static str>), AppError> {
    let bezeichnung = pflicht_max(&body.bezeichnung, "Bezeichnung", BEZEICHNUNG_MAX)?;
    let einsatzart = match body
        .einsatzart
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(art) => Some(
            Einsatzart::parse(art)
                .ok_or_else(|| AppError::Validation("Ungültige Einsatzart".into()))?,
        ),
        None => None,
    };
    let ausgeblendet = normalize_ausgeblendet(&body.ausgeblendet)?;
    Ok((bezeichnung, einsatzart, ausgeblendet))
}

/// POST /api/einsatz-vorlagen — Admin. Legt eine Vorlage am Ende der Liste an (201). Feldfehler
/// 400, Bezeichnung in der Organisation doppelt 409 (wie Stichworte und Einheiten-Vorlagen).
pub async fn create(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    JsonBody(body): JsonBody<EinsatzVorlageEingabe>,
) -> Result<(StatusCode, Json<EinsatzVorlage>), AppError> {
    let (bezeichnung, einsatzart, ausgeblendet) = check_eingabe(&body)?;
    let vorlage = repo::create(
        &state.pool,
        benutzer.org_id,
        VorlageDaten {
            bezeichnung: &bezeichnung,
            einsatzart,
            ausgeblendet: &ausgeblendet,
        },
    )
    .await?;
    Ok((StatusCode::CREATED, Json(vorlage)))
}

/// PUT /api/einsatz-vorlagen/{id} — Admin, Vollersatz von Bezeichnung, Einsatzart und
/// Modulmenge; `sortier` bleibt. Fremde oder unbekannte id 404, Feldfehler 400, Bezeichnung
/// doppelt 409. Wirkt nur auf neue Einsätze.
pub async fn update(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
    JsonBody(body): JsonBody<EinsatzVorlageEingabe>,
) -> Result<Json<EinsatzVorlage>, AppError> {
    let (bezeichnung, einsatzart, ausgeblendet) = check_eingabe(&body)?;
    let vorlage = repo::update(
        &state.pool,
        benutzer.org_id,
        id,
        VorlageDaten {
            bezeichnung: &bezeichnung,
            einsatzart,
            ausgeblendet: &ausgeblendet,
        },
    )
    .await?;
    Ok(Json(vorlage))
}

/// DELETE /api/einsatz-vorlagen/{id} — Admin (204). Gekoppelte Stichwort-Vorschläge bleiben,
/// ohne Vorlage. Fremde oder unbekannte id 404.
pub async fn delete(
    State(state): State<AppState>,
    AdminUser(benutzer): AdminUser,
    PfadParam(id): PfadParam<i64>,
) -> Result<StatusCode, AppError> {
    repo::delete(&state.pool, benutzer.org_id, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
