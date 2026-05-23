use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_einsatzleitung, fordere_mitglied};
use crate::einsatz::{repo, EinsatzAnzeige, EINSATZ_ROLLE_LEITUNG};
use crate::error::AppError;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct NeuerEinsatz {
    pub bezeichnung: String,
    pub stichwort: Option<String>,
}

/// POST /api/einsaetze — neuen Einsatz anlegen; Ersteller wird Einsatzleitung.
/// Erfordert Anlege-Berechtigung (System-Admin oder org-weite Führungskraft).
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Json(req): Json<NeuerEinsatz>,
) -> Result<(StatusCode, Json<EinsatzAnzeige>), AppError> {
    if !benutzer.darf_einsatz_anlegen() {
        return Err(AppError::Forbidden);
    }
    if req.bezeichnung.trim().is_empty() {
        return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
    }
    let stichwort = req
        .stichwort
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let einsatz = repo::anlegen(&state.pool, req.bezeichnung.trim(), stichwort, benutzer.id).await?;
    Ok((
        StatusCode::CREATED,
        Json(einsatz.anzeige(Some(EINSATZ_ROLLE_LEITUNG.to_string()))),
    ))
}

/// GET /api/einsaetze — alle Einsätze mit der Rolle des Abfragenden (`meine_rolle`).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
) -> Result<Json<Vec<EinsatzAnzeige>>, AppError> {
    Ok(Json(repo::liste_fuer(&state.pool, benutzer.id).await?))
}

/// GET /api/einsaetze/{id} — Einsatz-Detail; nur für Mitglieder.
pub async fn detail(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<EinsatzAnzeige>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    let rolle = fordere_mitglied(rolle)?;
    Ok(Json(einsatz.anzeige(Some(rolle.as_str().to_string()))))
}

/// POST /api/einsaetze/{id}/abschliessen — Einsatz abschließen (read-only).
/// Nur Einsatzleitung, nur wenn der Einsatz aktuell aktiv ist.
pub async fn abschliessen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(id): Path<i64>,
) -> Result<Json<EinsatzAnzeige>, AppError> {
    let einsatz = repo::laden(&state.pool, id).await?;
    let rolle = repo::rolle_von(&state.pool, id, benutzer.id).await?;
    fordere_einsatzleitung(rolle)?;
    fordere_aktiv(&einsatz)?;

    let aktualisiert = repo::abschliessen(&state.pool, id, benutzer.id).await?;
    Ok(Json(aktualisiert.anzeige(rolle.map(|r| r.as_str().to_string()))))
}
