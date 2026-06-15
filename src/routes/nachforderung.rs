use crate::app::AppState;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::nachforderung::{repo, NachforderungAnzeige, PRIO_NORMAL, STATUS_ABGELEHNT};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use chrono::{NaiveDateTime, Utc};
use serde::Deserialize;

/// Kanonischer Zeitstempel „jetzt" (UTC) im DB-Format.
fn jetzt() -> String {
    Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// SSE-Notify: Nachforderungen des Einsatzes haben sich geändert (Tag `nachforderung`,
/// auf der EINEN bestehenden /etb/stream-Verbindung).
fn sse(state: &AppState, einsatz_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        "nachforderung",
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
}

/// Normalisiert einen Eingabe-Zeitstempel auf 'YYYY-MM-DD HH:MM:SS' (UTC).
fn parse_zeit(roh: &str) -> Result<String, AppError> {
    let roh = roh.trim().replace('T', " ");
    for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(n) = NaiveDateTime::parse_from_str(&roh, fmt) {
            return Ok(n.format("%Y-%m-%d %H:%M:%S").to_string());
        }
    }
    Err(AppError::Validation("Ungültiger Zeitpunkt".into()))
}

fn trimme(o: &Option<String>) -> Option<&str> {
    o.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
}

/// GET /api/einsaetze/{id}/nachforderungen — listen (Lesezugriff, auch Beobachter).
pub async fn liste(
    State(state): State<AppState>,
    crate::auth::session::CurrentUser(benutzer): crate::auth::session::CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<NachforderungAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    let status = params.status.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if let Some(s) = status {
        if !crate::nachforderung::status_gueltig(s) {
            return Err(AppError::Validation("Ungültiger Status-Filter".into()));
        }
    }
    Ok(Json(repo::liste(&state.pool, einsatz_id, status).await?))
}

#[derive(Debug, Deserialize)]
pub struct NeueNachforderung {
    pub art: String,
    pub bezeichnung: String,
    pub anzahl: Option<i64>,
    pub adressat_kategorie: String,
    pub adressat_bezeichnung: Option<String>,
    pub begruendung: Option<String>,
    pub prioritaet: Option<String>,
    /// Ereigniszeit der Anforderung (UTC); leer = jetzt.
    pub angefordert_at: Option<String>,
}

/// POST /api/einsaetze/{id}/nachforderungen — Nachforderung absetzen (Schreibrecht + aktiv).
pub async fn anlegen(
    State(state): State<AppState>,
    crate::auth::session::CurrentUser(benutzer): crate::auth::session::CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(req): Json<NeueNachforderung>,
) -> Result<(StatusCode, Json<NachforderungAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    let art = req.art.trim();
    let bezeichnung = req.bezeichnung.trim();
    if art.is_empty() {
        return Err(AppError::Validation("Art darf nicht leer sein".into()));
    }
    if bezeichnung.is_empty() {
        return Err(AppError::Validation("Bezeichnung darf nicht leer sein".into()));
    }
    if let Some(a) = req.anzahl {
        if a < 1 {
            return Err(AppError::Validation("Anzahl muss mindestens 1 sein".into()));
        }
    }
    let prioritaet = req.prioritaet.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or(PRIO_NORMAL);
    if !crate::nachforderung::prioritaet_gueltig(prioritaet) {
        return Err(AppError::Validation("Ungültige Priorität".into()));
    }
    let adressat = req.adressat_kategorie.trim();
    if !crate::nachforderung::adressat_kategorie_gueltig(adressat) {
        return Err(AppError::Validation("Ungültige Adressat-Kategorie".into()));
    }
    let angefordert = match trimme(&req.angefordert_at) {
        Some(a) => parse_zeit(a)?,
        None => jetzt(),
    };

    let n = repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        repo::NachforderungDaten {
            art,
            bezeichnung,
            anzahl: req.anzahl,
            adressat_kategorie: adressat,
            adressat_bezeichnung: trimme(&req.adressat_bezeichnung),
            begruendung: trimme(&req.begruendung),
            prioritaet,
            angefordert_at: &angefordert,
        },
    )
    .await?;

    // Erzeugte ETB-Meldung in den Live-Feed (wie Auftrag/Meldung) + nachforderung-Event.
    if let Some(etb_id) = n.etb_nachforderung_id {
        if let Ok(etb) = crate::etb::repo::laden(&state.pool, etb_id).await {
            if let Ok(json) = serde_json::to_string(&etb) {
                state.live.publiziere(einsatz_id, json);
            }
        }
    }
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(n)))
}

/// Gemeinsamer Vorlauf für Nachforderungs-Aktionen: Gates + Cross-Einsatz-Schutz.
async fn fordere_bearbeitbar(
    state: &AppState,
    benutzer: &crate::auth::Benutzer,
    einsatz_id: i64,
    nachforderung_id: i64,
) -> Result<(), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    if !repo::gehoert_zu_einsatz(&state.pool, nachforderung_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct StatusReq {
    pub status: String,
}

/// POST /api/einsaetze/{id}/nachforderungen/{nid}/status — Bedarfs-Status weiterschalten.
pub async fn status(
    State(state): State<AppState>,
    crate::auth::session::CurrentUser(benutzer): crate::auth::session::CurrentUser,
    Path((einsatz_id, nachforderung_id)): Path<(i64, i64)>,
    Json(req): Json<StatusReq>,
) -> Result<Json<NachforderungAnzeige>, AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, nachforderung_id).await?;
    let neu = req.status.trim();
    // Ablehnung hat einen eigenen Pfad (mit Grund) — hier sauber abweisen statt im Repo auf 400 zu fallen.
    if neu == STATUS_ABGELEHNT {
        return Err(AppError::UnprocessableEntity("Ablehnung erfolgt über den /ablehnen-Endpoint".into()));
    }
    let aktuell = repo::laden(&state.pool, nachforderung_id).await?;
    if !crate::nachforderung::uebergang_erlaubt(&aktuell.status, neu) {
        return Err(AppError::UnprocessableEntity(format!(
            "Übergang {} → {neu} nicht erlaubt",
            aktuell.status
        )));
    }
    // Optimistische Sperre gegen TOCTOU: UPDATE greift nur bei unverändertem Bestandsstatus.
    if !repo::setze_status(&state.pool, nachforderung_id, neu, &aktuell.status, &jetzt()).await? {
        return Err(AppError::UnprocessableEntity("Status wurde zwischenzeitlich geändert".into()));
    }
    let n = repo::laden(&state.pool, nachforderung_id).await?;
    sse(&state, einsatz_id);
    Ok(Json(n))
}

#[derive(Debug, Deserialize)]
pub struct AblehnenReq {
    pub grund: Option<String>,
}

/// POST /api/einsaetze/{id}/nachforderungen/{nid}/ablehnen — Abzweig „abgelehnt".
pub async fn ablehnen(
    State(state): State<AppState>,
    crate::auth::session::CurrentUser(benutzer): crate::auth::session::CurrentUser,
    Path((einsatz_id, nachforderung_id)): Path<(i64, i64)>,
    Json(req): Json<AblehnenReq>,
) -> Result<Json<NachforderungAnzeige>, AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, nachforderung_id).await?;
    let aktuell = repo::laden(&state.pool, nachforderung_id).await?;
    if !crate::nachforderung::uebergang_erlaubt(&aktuell.status, STATUS_ABGELEHNT) {
        return Err(AppError::UnprocessableEntity(
            "Nachforderung kann in diesem Zustand nicht abgelehnt werden".into(),
        ));
    }
    if !repo::lehne_ab(&state.pool, nachforderung_id, trimme(&req.grund), &aktuell.status, &jetzt()).await? {
        return Err(AppError::UnprocessableEntity("Status wurde zwischenzeitlich geändert".into()));
    }
    let n = repo::laden(&state.pool, nachforderung_id).await?;
    sse(&state, einsatz_id);
    Ok(Json(n))
}
