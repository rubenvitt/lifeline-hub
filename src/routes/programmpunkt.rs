//! Programmpunkte der Veranstaltung (LLH-1570, Spec `ablaufplan`): `GET`/`POST
//! /api/incidents/{id}/agenda-items`, `PATCH`/`DELETE …/{pid}`.
//!
//! Lesen mit dem Einsatz (kein Modul), Schreiben mit den Rechten der Kopfdaten
//! (`EinsatzVerwaltungszugriff`). Eine Änderung meldet das Ereignis `einsatz`, damit Einsatzdaten
//! und Überblick nachladen. Herleitung: `/mnt/project-files/llh-1570/design.md` (D1–D3).

use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzVerwaltungszugriff};
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::live::LiveEvent;
use crate::programmpunkt::{repo, Programmpunkt, PROGRAMMPUNKT_BEZEICHNUNG_MAX};
use crate::routes::support::{pflicht_max, pflicht_max_tri};
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct NeuerProgrammpunkt {
    pub bezeichnung: String,
    pub zeitpunkt_at: String,
}

/// PATCH-Body: absent = unverändert; beide Felder sind Pflichtangaben und werden nie geleert.
#[derive(Debug, Deserialize)]
pub struct ProgrammpunktPatch {
    pub bezeichnung: Option<String>,
    pub zeitpunkt_at: Option<String>,
    /// Feld-CAS (LLH-1945, Spec `formularseiten`, „Einzelangabe prüft auf zwischenzeitliche
    /// Änderung“): je geänderter Angabe ihr Wert beim Öffnen; fehlt = kein Vergleich. Die Planung
    /// (`planung::update_programmpunkt`) hat einen eigenen Weg und kennt das Feld nicht.
    pub erwartet: Option<ProgrammpunktErwartet>,
}

/// Altwerte eines Programmpunkts. Beide Angaben sind Pflicht, ein leerer Altwert kommt nicht vor.
#[derive(Debug, Default, Deserialize)]
pub struct ProgrammpunktErwartet {
    pub bezeichnung: Option<String>,
    pub zeitpunkt_at: Option<String>,
}

/// Formulareingabe → kanonischer UTC-Zeitstempel mit Jahr im Bereich (400, LFH-924). Auch für
/// die Programmpunkte der Planung (LLH-1583).
pub(crate) fn parse_zeitpunkt(roh: &str) -> Result<String, AppError> {
    let normal = crate::zeit::normalisiere_eingabe(roh)
        .ok_or_else(|| AppError::Validation("Ungültiger Zeitpunkt".into()))?;
    crate::zeit::im_jahresbereich(normal, "Zeitpunkt")
}

fn melden(state: &AppState, einsatz_id: i64) {
    state
        .live
        .publiziere_einsatz(einsatz_id, LiveEvent::Einsatz);
}

/// GET /api/incidents/{id}/agenda-items — alle Programmpunkte nach Zeitpunkt.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff,
) -> Result<Json<Vec<Programmpunkt>>, AppError> {
    Ok(Json(repo::liste(&state.pool, ctx.einsatz.id).await?))
}

/// POST /api/incidents/{id}/agenda-items — anlegen (201).
pub async fn anlegen(
    State(state): State<AppState>,
    ctx: EinsatzVerwaltungszugriff,
    JsonBody(req): JsonBody<NeuerProgrammpunkt>,
) -> Result<(StatusCode, Json<Programmpunkt>), AppError> {
    let bezeichnung = pflicht_max(
        &req.bezeichnung,
        "Bezeichnung",
        PROGRAMMPUNKT_BEZEICHNUNG_MAX,
    )?;
    let zeitpunkt = parse_zeitpunkt(&req.zeitpunkt_at)?;
    let p = repo::anlegen(
        &state.pool,
        ctx.einsatz.id,
        ctx.benutzer.id,
        &bezeichnung,
        &zeitpunkt,
    )
    .await?;
    melden(&state, ctx.einsatz.id);
    Ok((StatusCode::CREATED, Json(p)))
}

/// PATCH /api/incidents/{id}/agenda-items/{pid} — Bezeichnung und/oder Zeitpunkt ändern.
pub async fn aendern(
    State(state): State<AppState>,
    ctx: EinsatzVerwaltungszugriff,
    PfadParam((_, pid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<ProgrammpunktPatch>,
) -> Result<Json<Programmpunkt>, AppError> {
    let bezeichnung = pflicht_max_tri(
        req.bezeichnung.as_deref(),
        "Bezeichnung",
        PROGRAMMPUNKT_BEZEICHNUNG_MAX,
    )?;
    let zeitpunkt = req
        .zeitpunkt_at
        .as_deref()
        .map(parse_zeitpunkt)
        .transpose()?;
    let erwartet = req.erwartet.unwrap_or_default();
    crate::feld_cas::pruefe_felder(
        &[
            (
                "bezeichnung",
                erwartet.bezeichnung.is_some(),
                bezeichnung.is_some(),
            ),
            (
                "zeitpunkt_at",
                erwartet.zeitpunkt_at.is_some(),
                zeitpunkt.is_some(),
            ),
        ],
        &[],
    )?;
    // Der Altwert des Zeitpunkts in derselben kanonischen Form, in der die Spalte ihn trägt.
    let erwartet_zeitpunkt = erwartet
        .zeitpunkt_at
        .as_deref()
        .map(parse_zeitpunkt)
        .transpose()?;
    let mut w = crate::feld_cas::ExpectedValues::new();
    w.push(
        "bezeichnung",
        erwartet
            .bezeichnung
            .as_deref()
            .map(|b| crate::feld_cas::ExpectedValue::Text(Some(b.trim()))),
    );
    w.push(
        "zeitpunkt_at",
        erwartet_zeitpunkt
            .as_deref()
            .map(|z| crate::feld_cas::ExpectedValue::Text(Some(z))),
    );
    let p = repo::aendern(
        &state.pool,
        ctx.einsatz.id,
        pid,
        bezeichnung.as_deref(),
        zeitpunkt.as_deref(),
        &w,
    )
    .await?;
    melden(&state, ctx.einsatz.id);
    Ok(Json(p))
}

/// DELETE /api/incidents/{id}/agenda-items/{pid} — löschen (204).
pub async fn loeschen(
    State(state): State<AppState>,
    ctx: EinsatzVerwaltungszugriff,
    PfadParam((_, pid)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    repo::loeschen(&state.pool, ctx.einsatz.id, pid).await?;
    melden(&state, ctx.einsatz.id);
    Ok(StatusCode::NO_CONTENT)
}
