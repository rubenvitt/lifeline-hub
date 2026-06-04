use crate::app::AppState;
use crate::auth::session::CurrentUser;
use crate::einsatz::berechtigung::{fordere_aktiv, fordere_lesezugriff, fordere_schreibrecht};
use crate::einsatz::repo as einsatz_repo;
use crate::error::AppError;
use crate::etb::{self, repo as etb_repo};
use crate::gefahr::repo::{self as gefahr_repo, BewertungDaten};
use crate::gefahr::{self, GefahrBewertungAnzeige};
use axum::extract::{Path, State};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::Json;
use serde::Deserialize;
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt};

/// SSE-Notify: die Gefahrenmatrix hat sich geändert. Event-Tag `gefahr`.
fn sse_gefahr(state: &AppState, einsatz_id: i64) {
    let data = serde_json::json!({ "einsatz_id": einsatz_id }).to_string();
    state.live.publiziere_event(einsatz_id, "gefahr", data);
}

/// Schreibt einen System-ETB-Eintrag und publiziert ihn live (Muster wie lage_zone).
async fn etb_system(state: &AppState, einsatz_id: i64, benutzer_id: i64, inhalt: &str) -> Result<(), AppError> {
    let anzeige = etb_repo::anlegen(
        &state.pool, einsatz_id, benutzer_id,
        etb_repo::EintragDaten {
            typ: etb::TYP_SYSTEM, inhalt, von: None, an: None, meldeweg: None,
            veranlassung: None, ereigniszeit: None, erfasst_lokal_at: None, berichtigt_eintrag_id: None,
        },
    ).await?;
    if let Ok(json) = serde_json::to_string(&anzeige) {
        state.live.publiziere(einsatz_id, json);
    }
    Ok(())
}

fn trimme(s: Option<String>) -> Option<String> {
    s.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// GET /api/einsaetze/{id}/gefahrenmatrix — gesetzte Zellen (Frontend rendert das Raster).
/// Nur Lesezugriff.
pub async fn matrix(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Json<Vec<GefahrBewertungAnzeige>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;
    Ok(Json(gefahr_repo::liste(&state.pool, einsatz_id).await?))
}

#[derive(Debug, Deserialize)]
pub struct BewertungBody {
    pub gefahrentyp: String,
    pub schutzobjekt: String,
    pub warnstufe: String,
    pub beschreibung: Option<String>,
    pub gemeldet_von: Option<String>,
}

/// PUT /api/einsaetze/{id}/gefahrenmatrix/bewertung — Zelle setzen (UPSERT).
/// Schreibrecht + aktiv. ETB nur bei realer Warnstufen-Änderung (auch keine↔x).
pub async fn bewerten(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
    Json(body): Json<BewertungBody>,
) -> Result<Json<GefahrBewertungAnzeige>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_schreibrecht(rolle)?;
    fordere_aktiv(&einsatz)?;

    if !gefahr::GEFAHRENTYPEN.contains(&body.gefahrentyp.as_str()) {
        return Err(AppError::UnprocessableEntity(format!("Unbekannter Gefahrentyp: {}", body.gefahrentyp)));
    }
    if !gefahr::SCHUTZOBJEKTE.contains(&body.schutzobjekt.as_str()) {
        return Err(AppError::UnprocessableEntity(format!("Unbekanntes Schutzobjekt: {}", body.schutzobjekt)));
    }
    if !gefahr::WARNSTUFEN.contains(&body.warnstufe.as_str()) {
        return Err(AppError::UnprocessableEntity(format!("Unbekannte Warnstufe: {}", body.warnstufe)));
    }
    if !gefahr::kombination_gueltig(&body.gefahrentyp, &body.schutzobjekt) {
        return Err(AppError::UnprocessableEntity(format!(
            "Kombination {} × {} ist nicht zulässig", body.gefahrentyp, body.schutzobjekt
        )));
    }

    let alt = gefahr_repo::aktuelle_warnstufe(&state.pool, einsatz_id, &body.gefahrentyp, &body.schutzobjekt)
        .await?
        .unwrap_or_else(|| "keine".to_string());

    let beschreibung = trimme(body.beschreibung.clone());
    let gemeldet_von = trimme(body.gemeldet_von.clone());
    let z = gefahr_repo::upsert_bewertung(&state.pool, einsatz_id, BewertungDaten {
        gefahrentyp: &body.gefahrentyp,
        schutzobjekt: &body.schutzobjekt,
        warnstufe: &body.warnstufe,
        beschreibung: beschreibung.as_deref(),
        gemeldet_von: gemeldet_von.as_deref(),
        aktualisiert_von: benutzer.id,
    }).await?;

    if z.warnstufe != alt {
        let g = gefahr::gefahrentyp_label(&z.gefahrentyp);
        let o = gefahr::schutzobjekt_label(&z.schutzobjekt);
        let text = if z.warnstufe == "keine" {
            format!("Gefahr «{g}» für «{o}» aufgehoben.")
        } else {
            format!("Gefahr «{g}» für «{o}» auf Warnstufe «{}» gesetzt.", z.warnstufe)
        };
        etb_system(&state, einsatz_id, benutzer.id, &text).await?;
    }
    sse_gefahr(&state, einsatz_id);
    Ok(Json(z))
}

/// GET /api/einsaetze/{id}/gefahrenmatrix/stream — SSE (ganzer Einsatz-Kanal, verbatim).
/// Symmetrie zu lage_zone/abschnitt. Die SPA konsumiert das `gefahr`-Event über den
/// gemeinsamen `/etb/stream`, NICHT über diese Route (siehe useEinsatzLiveStream).
pub async fn stream(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    Path(einsatz_id): Path<i64>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let einsatz = einsatz_repo::laden(&state.pool, einsatz_id).await?;
    let rolle = einsatz_repo::rolle_von(&state.pool, einsatz_id, benutzer.id).await?;
    fordere_lesezugriff(&benutzer, &einsatz, rolle)?;

    let rx = state.live.abonniere(einsatz_id);
    let stream = BroadcastStream::new(rx).map(|res| {
        let event = match res {
            Ok(n) => Event::default().event(n.event).data(n.data),
            Err(_) => Event::default().event("lagged").data("resync"),
        };
        Ok::<Event, Infallible>(event)
    });
    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
