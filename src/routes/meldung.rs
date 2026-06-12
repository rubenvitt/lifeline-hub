use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::meldung::{repo, MeldungAnzeige, ART_SONSTIGE, PRIO_NORMAL};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Kanonischer Zeitstempel „jetzt" (UTC) im DB-Format.
fn jetzt() -> String {
    chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

/// SSE-Notify: Meldungen des Einsatzes haben sich geändert (Tag `meldung`).
fn sse(state: &AppState, einsatz_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        "meldung",
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
}

fn trimme(o: &Option<String>) -> Option<&str> {
    o.as_deref().map(str::trim).filter(|s| !s.is_empty())
}

#[derive(Debug, Deserialize)]
pub struct ListeParams {
    pub status: Option<String>,
}

/// GET /api/einsaetze/{id}/meldungen — Posteingang listen (Lesezugriff, auch Beobachter).
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Query(params): Query<ListeParams>,
) -> Result<Json<Vec<MeldungAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    let status = params.status.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if let Some(s) = status {
        if !crate::meldung::status_gueltig(s) {
            return Err(AppError::Validation("Ungültiger Status-Filter".into()));
        }
    }
    Ok(Json(repo::liste(&state.pool, einsatz_id, status).await?))
}

#[derive(Debug, Deserialize)]
pub struct NeueMeldung {
    pub absender: String,
    pub empfaenger: Option<String>,
    pub meldeweg: String,
    pub inhalt: String,
    pub meldungsart: Option<String>,
    pub prioritaet: Option<String>,
    /// Ereigniszeit (UTC, ISO-8601 oder SQLite-Format). Pflicht (Funk-Realität: ≠ Erfassung).
    pub ereigniszeit: String,
}

/// POST /api/einsaetze/{id}/meldungen — Meldung erfassen (Schreibrecht + aktiv).
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(req): Json<NeueMeldung>,
) -> Result<(StatusCode, Json<MeldungAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    // Mindestfelder: Absender, Inhalt, Meldeweg.
    let absender = req.absender.trim();
    let inhalt = req.inhalt.trim();
    if absender.is_empty() {
        return Err(AppError::Validation("Absender darf nicht leer sein".into()));
    }
    if inhalt.is_empty() {
        return Err(AppError::Validation("Inhalt darf nicht leer sein".into()));
    }
    if crate::meldung::MeldeWeg::parse(req.meldeweg.trim()).is_none() {
        return Err(AppError::Validation("Ungültiger Meldeweg".into()));
    }
    let meldungsart = req
        .meldungsart
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(ART_SONSTIGE);
    if !crate::meldung::meldungsart_gueltig(meldungsart) {
        return Err(AppError::Validation("Ungültige Meldungsart".into()));
    }
    let prioritaet = req
        .prioritaet
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(PRIO_NORMAL);
    if !crate::meldung::prioritaet_gueltig(prioritaet) {
        return Err(AppError::Validation("Ungültige Priorität".into()));
    }
    // Ereigniszeit normalisieren (ISO-8601/SQLite → SQLite-Format), wie ETB.
    let ereigniszeit = crate::etb::normalisiere_zeit(req.ereigniszeit.trim())?;
    let eingang = jetzt();

    let m = repo::anlegen(
        &state.pool,
        einsatz_id,
        benutzer.id,
        repo::MeldungDaten {
            absender,
            empfaenger: trimme(&req.empfaenger),
            meldeweg: req.meldeweg.trim(),
            inhalt,
            meldungsart,
            prioritaet,
            ereigniszeit: &ereigniszeit,
            eingang_at: &eingang,
        },
    )
    .await?;

    // Dual-Publish (wie Auftrag): erzeugte ETB-Meldung in den Live-Feed + meldung-Event.
    if let Some(etb_id) = m.etb_meldung_id {
        if let Ok(etb) = crate::etb::repo::laden(&state.pool, etb_id).await {
            if let Ok(json) = serde_json::to_string(&etb) {
                state.live.publiziere(einsatz_id, json);
            }
        }
    }
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(m)))
}

/// Gemeinsamer Vorlauf für Meldungs-Aktionen: Gates + Cross-Einsatz-Schutz.
async fn fordere_bearbeitbar(
    state: &AppState,
    benutzer: &crate::auth::Benutzer,
    einsatz_id: i64,
    meldung_id: i64,
) -> Result<(), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;
    if !repo::gehoert_zu_einsatz(&state.pool, meldung_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct StatusReq {
    pub status: String,
    pub bearbeiter_id: Option<i64>,
}

/// POST /api/einsaetze/{id}/meldungen/{mid}/status — Status setzen + optional Bearbeiter.
pub async fn status(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, meldung_id)): Path<(i64, i64)>,
    Json(req): Json<StatusReq>,
) -> Result<Json<MeldungAnzeige>, AppError> {
    fordere_bearbeitbar(&state, &benutzer, einsatz_id, meldung_id).await?;
    let status = req.status.trim();
    if !crate::meldung::status_gueltig(status) {
        return Err(AppError::Validation("Ungültiger Status".into()));
    }
    // Bearbeiter (falls gesetzt) muss Einsatz-Mitglied sein (Cross-Einsatz-Schutz).
    if let Some(bid) = req.bearbeiter_id {
        if einsatz_repo::rolle_von(&state.pool, einsatz_id, bid).await?.is_none() {
            return Err(AppError::Validation("Bearbeiter ist kein Einsatz-Mitglied".into()));
        }
    }
    repo::setze_status(&state.pool, meldung_id, status, req.bearbeiter_id).await?;
    let m = repo::laden(&state.pool, meldung_id).await?;
    sse(&state, einsatz_id);
    Ok(Json(m))
}
