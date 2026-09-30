//! Routen des Informationstelefons S5 (LFH-554) unter `/api/einsaetze/{id}/stab/infotelefon`.
//!
//! Gates über `EinsatzLesezugriff<Stab>` bzw. `EinsatzSchreibzugriff<Stab>`; das Protokoll
//! erbt die Sperre des Stab-Moduls. Live: `LiveEvent::Infotelefon` nur mit Kennungen, nie mit
//! Namen, Nummern oder Notizen.

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Stab;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::infotelefon::repo::{self, AnrufEingabe};
use crate::infotelefon::{InfotelefonAnliegen, InfotelefonAnrufAnzeige, InfotelefonStatus};
use crate::live::LiveEvent;

fn sse(state: &AppState, einsatz_id: i64, id: i64) {
    state
        .live
        .publiziere_objekt(einsatz_id, LiveEvent::Infotelefon, "anruf_id", id);
}

/// GET /api/einsaetze/{id}/stab/infotelefon — jüngster Eingang zuerst.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Stab>,
) -> Result<Json<Vec<InfotelefonAnrufAnzeige>>, AppError> {
    Ok(Json(repo::liste(&state.pool, ctx.einsatz.id).await?))
}

#[derive(Debug, Deserialize)]
pub struct AnrufAnlegen {
    /// Als `String`, damit ein unbekannter Wert eine benannte 400 liefert.
    anliegen: String,
    #[serde(default)]
    notiz: Option<String>,
    #[serde(default)]
    anrufer_name: Option<String>,
    #[serde(default)]
    rueckruf: Option<String>,
    #[serde(default)]
    rueckruf_noetig: bool,
    /// Fehlt = jetzt (Nachtragen einer früheren Uhrzeit ist möglich).
    #[serde(default)]
    eingang_at: Option<String>,
}

/// POST /api/einsaetze/{id}/stab/infotelefon
pub async fn anlegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    JsonBody(req): JsonBody<AnrufAnlegen>,
) -> Result<(StatusCode, Json<InfotelefonAnrufAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let anliegen = InfotelefonAnliegen::parse(&req.anliegen)
        .ok_or_else(|| AppError::Validation(format!("Unbekanntes Anliegen '{}'", req.anliegen)))?;
    let eingang_at = match req
        .eingang_at
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
    {
        Some(z) => crate::etb::normalisiere_zeit(z)?,
        None => crate::zeit::jetzt(),
    };
    let eingabe = AnrufEingabe {
        anliegen,
        notiz: req.notiz,
        anrufer_name: req.anrufer_name,
        rueckruf: req.rueckruf,
        rueckruf_noetig: req.rueckruf_noetig,
        eingang_at,
    };
    let benutzer_id = ctx.benutzer.id;
    let id = crate::write_retry!(&state.pool, |conn| {
        repo::anlegen_tx(conn, einsatz_id, benutzer_id, &eingabe).await
    })?;
    sse(&state, einsatz_id, id);
    Ok((
        StatusCode::CREATED,
        Json(repo::laden(&state.pool, einsatz_id, id).await?),
    ))
}

#[derive(Debug, Deserialize)]
pub struct AnrufStatusSetzen {
    status: String,
}

/// POST /api/einsaetze/{id}/stab/infotelefon/{aid}/status — Rückruf erledigen oder öffnen.
pub async fn status_setzen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Stab>,
    PfadParam((_eid, aid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<AnrufStatusSetzen>,
) -> Result<Json<InfotelefonAnrufAnzeige>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let ziel = InfotelefonStatus::parse(&req.status).ok_or_else(|| {
        AppError::Validation(format!(
            "Unbekannter Status '{}' (erlaubt: offen, erledigt)",
            req.status
        ))
    })?;
    let benutzer_id = ctx.benutzer.id;
    crate::write_retry!(&state.pool, |conn| {
        repo::status_tx(conn, einsatz_id, aid, benutzer_id, ziel).await
    })?;
    sse(&state, einsatz_id, aid);
    Ok(Json(repo::laden(&state.pool, einsatz_id, aid).await?))
}
