use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::erinnerung::{repo, ErinnerungAnzeige, STATUS_ERLEDIGT, STATUS_QUITTIERT};
use crate::error::AppError;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{NaiveDateTime, Utc};
use serde::Deserialize;

/// Kanonischer Zeitstempel „jetzt" (UTC) im DB-Format.
fn jetzt() -> String {
    Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// SSE-Notify: Erinnerungen des Einsatzes haben sich geändert (Tag `erinnerung`).
fn sse(state: &AppState, einsatz_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        "erinnerung",
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    /// `true` → nur offene Erinnerungen.
    pub nur_offen: Option<bool>,
}

/// GET /api/einsaetze/{id}/erinnerungen — Erinnerungen listen (Lesezugriff).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<ErinnerungAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    let nur_offen = params.nur_offen.unwrap_or(false);
    Ok(Json(repo::liste(&state.pool, einsatz_id, nur_offen, &jetzt()).await?))
}

#[derive(Debug, Deserialize)]
pub struct NeueErinnerung {
    pub titel: String,
    pub beschreibung: Option<String>,
    /// 'YYYY-MM-DD HH:MM' oder mit Sekunden (UTC).
    pub faellig_at: String,
    pub intervall_minuten: Option<i64>,
    pub empfaenger_funktion: Option<String>,
}

/// Normalisiert einen Eingabe-Zeitstempel auf 'YYYY-MM-DD HH:MM:SS' (UTC).
/// Akzeptiert mit/ohne Sekunden; sonst `Validation`.
fn parse_faellig(roh: &str) -> Result<String, AppError> {
    let roh = roh.trim().replace('T', " ");
    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(n) = NaiveDateTime::parse_from_str(&roh, fmt) {
            return Ok(n.format("%Y-%m-%d %H:%M:%S").to_string());
        }
    }
    Err(AppError::Validation("Ungültiger Fälligkeitszeitpunkt".into()))
}

/// POST /api/einsaetze/{id}/erinnerungen — Erinnerung anlegen (Schreibrecht + aktiv).
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(req): Json<NeueErinnerung>,
) -> Result<(StatusCode, Json<ErinnerungAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let titel = req.titel.trim();
    if titel.is_empty() {
        return Err(AppError::Validation("Titel darf nicht leer sein".into()));
    }
    if let Some(iv) = req.intervall_minuten {
        if iv <= 0 {
            return Err(AppError::Validation("Intervall muss positiv sein".into()));
        }
    }
    let faellig = parse_faellig(&req.faellig_at)?;
    let beschreibung = req.beschreibung.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let empfaenger = req.empfaenger_funktion.as_deref().map(str::trim).filter(|s| !s.is_empty());

    let r = repo::anlegen(&state.pool, einsatz_id, benutzer.id, repo::ErinnerungDaten {
        titel, beschreibung, faellig_at: &faellig,
        intervall_minuten: req.intervall_minuten, empfaenger_funktion: empfaenger,
    }, &jetzt()).await?;
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(r)))
}

/// Gemeinsamer Vorlauf für Status-Übergänge: Gates + Cross-Einsatz-Schutz.
async fn fordere_bearbeitbar(
    state: &AppState,
    benutzer: &crate::auth::Benutzer,
    einsatz_id: i64,
    erinnerung_id: i64,
) -> Result<(), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    if !repo::gehoert_zu_einsatz(&state.pool, erinnerung_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    Ok(())
}

/// POST /api/einsaetze/{id}/erinnerungen/{eid}/erledigen — Status → erledigt.
pub async fn erledigen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, erinnerung_id)): Path<(i64, i64)>,
) -> Result<Json<ErinnerungAnzeige>, AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, erinnerung_id).await?;
    let r = repo::status_setzen(&state.pool, erinnerung_id, STATUS_ERLEDIGT, &jetzt()).await?;
    sse(&state, einsatz_id);
    Ok(Json(r))
}

/// POST /api/einsaetze/{id}/erinnerungen/{eid}/quittieren — Status → quittiert.
pub async fn quittieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, erinnerung_id)): Path<(i64, i64)>,
) -> Result<Json<ErinnerungAnzeige>, AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, erinnerung_id).await?;
    let r = repo::status_setzen(&state.pool, erinnerung_id, STATUS_QUITTIERT, &jetzt()).await?;
    sse(&state, einsatz_id);
    Ok(Json(r))
}
