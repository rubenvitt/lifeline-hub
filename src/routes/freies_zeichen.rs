use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{
    fordere_aktiv, fordere_lesezugriff, fordere_modul_zugriff_laden, fordere_schreibrecht,
};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::freies_zeichen::repo::{self as zeichen_repo, ZeichenNeu, ZeichenUpdate};
use crate::freies_zeichen::FreiesZeichenAnzeige;
use crate::live::LiveEvent;
use crate::routes::support::trimme;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

/// Modul-Key dieses Route-Moduls (LFH-132) — freie Zeichen leben auf der Lage-Karte.
const MODUL_KEY: &str = "lagekarte";

/// SSE-Notify (Lage-Karte): ein freies Zeichen hat sich geändert. Event-Tag `freies_zeichen`.
/// Der Wire-Tag ist load-bearing — das Frontend filtert exakt darauf.
fn sse_zeichen(state: &AppState, einsatz_id: i64, id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id, "zeichen_id": id }).to_string();
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::FreiesZeichen, data);
}

/// GET /api/einsaetze/{id}/freie-zeichen — Liste aller freien Zeichen. Nur Lesezugriff.
pub async fn liste(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<FreiesZeichenAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    Ok(Json(zeichen_repo::liste(&state.pool, einsatz_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct AnlegenBody {
    pub lat: f64,
    pub lon: f64,
    pub grundzeichen: String,
    pub organisation: Option<String>,
    pub fachaufgabe: Option<String>,
    pub symbol: Option<String>,
    pub einheit: Option<String>,
    pub funktion: Option<String>,
    pub farbe: Option<String>,
    pub label: Option<String>,
}

/// POST /api/einsaetze/{id}/freie-zeichen — anlegen. Schreibrecht + aktiv.
pub async fn anlegen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<AnlegenBody>,
) -> Result<(StatusCode, Json<FreiesZeichenAnzeige>), AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    let grundzeichen = grundzeichen_pflicht(&body.grundzeichen)?;
    let organisation = trimme(body.organisation.clone());
    let fachaufgabe = trimme(body.fachaufgabe.clone());
    let symbol = trimme(body.symbol.clone());
    let einheit = trimme(body.einheit.clone());
    let funktion = trimme(body.funktion.clone());
    let farbe = trimme(body.farbe.clone());
    let label = trimme(body.label.clone());

    let z = zeichen_repo::anlegen(
        &state.pool,
        einsatz_id,
        ZeichenNeu {
            lat: body.lat,
            lon: body.lon,
            grundzeichen: &grundzeichen,
            organisation: organisation.as_deref(),
            fachaufgabe: fachaufgabe.as_deref(),
            symbol: symbol.as_deref(),
            einheit: einheit.as_deref(),
            funktion: funktion.as_deref(),
            farbe: farbe.as_deref(),
            label: label.as_deref(),
            erstellt_von: benutzer.id,
        },
    )
    .await?;

    sse_zeichen(&state, einsatz_id, z.id);
    Ok((StatusCode::CREATED, Json(z)))
}

#[derive(Debug, Deserialize)]
pub struct PatchBody {
    pub grundzeichen: String,
    pub organisation: Option<String>,
    pub fachaufgabe: Option<String>,
    pub symbol: Option<String>,
    pub einheit: Option<String>,
    pub funktion: Option<String>,
    pub farbe: Option<String>,
    pub label: Option<String>,
}

/// PATCH /api/einsaetze/{id}/freie-zeichen/{zid} — Whole-Spec-Overwrite aller Overlays +
/// label + grundzeichen. lat/lon sind NICHT verschiebbar (v1). Schreibrecht + aktiv.
pub async fn aktualisieren(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, zid)): Path<(i64, i64)>,
    Json(body): Json<PatchBody>,
) -> Result<Json<FreiesZeichenAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    let grundzeichen = grundzeichen_pflicht(&body.grundzeichen)?;
    let organisation = trimme(body.organisation.clone());
    let fachaufgabe = trimme(body.fachaufgabe.clone());
    let symbol = trimme(body.symbol.clone());
    let einheit = trimme(body.einheit.clone());
    let funktion = trimme(body.funktion.clone());
    let farbe = trimme(body.farbe.clone());
    let label = trimme(body.label.clone());

    let z = zeichen_repo::aktualisiere(
        &state.pool,
        einsatz_id,
        zid,
        ZeichenUpdate {
            grundzeichen: &grundzeichen,
            organisation: organisation.as_deref(),
            fachaufgabe: fachaufgabe.as_deref(),
            symbol: symbol.as_deref(),
            einheit: einheit.as_deref(),
            funktion: funktion.as_deref(),
            farbe: farbe.as_deref(),
            label: label.as_deref(),
        },
    )
    .await?;

    sse_zeichen(&state, einsatz_id, zid);
    Ok(Json(z))
}

/// DELETE /api/einsaetze/{id}/freie-zeichen/{zid} — aufheben (Hard-Delete). Schreibrecht + aktiv.
pub async fn aufloesen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path((einsatz_id, zid)): Path<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_modul_zugriff_laden(
        &state.pool,
        einsatz_id,
        einsatz.org_id,
        MODUL_KEY,
        &benutzer,
    )
    .await?;
    fordere_aktiv(&einsatz)?;

    zeichen_repo::loese_auf(&state.pool, einsatz_id, zid).await?;
    sse_zeichen(&state, einsatz_id, zid);
    Ok(StatusCode::NO_CONTENT)
}

/// `grundzeichen` ist Pflicht: nach Trim non-empty, sonst 422. Liefert den getrimmten Wert.
fn grundzeichen_pflicht(roh: &str) -> Result<String, AppError> {
    let g = roh.trim();
    if g.is_empty() {
        return Err(AppError::UnprocessableEntity(
            "grundzeichen darf nicht leer sein".into(),
        ));
    }
    Ok(g.to_string())
}
