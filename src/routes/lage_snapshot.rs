//! HTTP-Routen für Lage-Snapshots (LFH-321, Inkrement C). Modul-gegatet auf `lagekarte`
//! (typisierte `EinsatzLesezugriff`/`EinsatzSchreibzugriff<Lagekarte>`-Extraktoren), Sub-IDs
//! über `PfadParam`, Bodies über `JsonBody`. Anlegen braucht Schreibrecht, Löschen (Dokumenten-
//! Vernichtung) die Einsatzleitung. `daten`/`stand_at`/`erstellt_*` sind unveränderlich.

use crate::app::AppState;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Lagekarte;
use crate::error::AppError;
use crate::extract::{JsonBody, PfadParam};
use crate::lage_snapshot::{repo, LageSnapshotAnzeige, LageSnapshotDokument};
use crate::live::LiveEvent;
use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;

/// SSE-Notify (Lage-Karte): ein Snapshot wurde angelegt/geändert/gelöscht. Wire-Tag
/// `lage_snapshot` — das Frontend filtert exakt darauf und invalidiert die Snapshot-Liste.
fn sse_snapshot(state: &AppState, einsatz_id: i64, snapshot_id: i64) {
    let data =
        serde_json::json!({ "einsatz_id": einsatz_id, "snapshot_id": snapshot_id }).to_string();
    state
        .live
        .publiziere_event(einsatz_id, LiveEvent::LageSnapshot, data);
}

/// GET /api/einsaetze/{id}/lage-snapshots — Metadaten-Liste (neueste zuerst, ohne `daten`).
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagekarte>,
) -> Result<Json<Vec<LageSnapshotAnzeige>>, AppError> {
    let liste = repo::liste_metadaten(&state.pool, ctx.einsatz.id).await?;
    Ok(Json(liste))
}

/// POST /api/einsaetze/{id}/lage-snapshots — „Stand sichern": friert das volle Lagebild ein.
pub async fn erzeugen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    PfadParam(_id): PfadParam<i64>,
    JsonBody(req): JsonBody<repo::NeuerLageSnapshot>,
) -> Result<(StatusCode, Json<LageSnapshotDokument>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let dok = repo::erzeuge(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        req.bezeichnung.as_deref(),
        req.notiz.as_deref(),
    )
    .await?;
    sse_snapshot(&state, einsatz_id, dok.id);
    Ok((StatusCode::CREATED, Json(dok)))
}

/// GET /api/einsaetze/{id}/lage-snapshots/{sid} — Volldokument eines Standes (inkl. `daten`).
pub async fn einzeln(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Lagekarte>,
    PfadParam((_id, sid)): PfadParam<(i64, i64)>,
) -> Result<Json<LageSnapshotDokument>, AppError> {
    let dok = repo::lade_dokument(&state.pool, ctx.einsatz.id, sid)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(dok))
}

/// PATCH /api/einsaetze/{id}/lage-snapshots/{sid} — NUR `bezeichnung`/`notiz` (unveränderliches
/// Dokument; `daten`/`stand_at`/`erstellt_*` sind im DTO strukturell nicht enthalten).
pub async fn patch(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    PfadParam((_id, sid)): PfadParam<(i64, i64)>,
    JsonBody(req): JsonBody<repo::PatchLageSnapshot>,
) -> Result<Json<LageSnapshotDokument>, AppError> {
    let einsatz_id = ctx.einsatz.id;
    repo::patche_meta(
        &state.pool,
        einsatz_id,
        sid,
        req.bezeichnung.as_ref().map(|o| o.as_deref()),
        req.notiz.as_ref().map(|o| o.as_deref()),
    )
    .await?;
    let dok = repo::lade_dokument(&state.pool, einsatz_id, sid)
        .await?
        .ok_or(AppError::NotFound)?;
    sse_snapshot(&state, einsatz_id, sid);
    Ok(Json(dok))
}

/// DELETE /api/einsaetze/{id}/lage-snapshots/{sid} — Dokumenten-Vernichtung. Nur Einsatzleitung
/// (`fordere_einsatzleitung`, über das Schreib-Gate hinaus). Unbekannte id → 404.
pub async fn loeschen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Lagekarte>,
    PfadParam((_id, sid)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    ctx.fordere_einsatzleitung()?;
    let einsatz_id = ctx.einsatz.id;
    if !repo::loesche(&state.pool, einsatz_id, sid).await? {
        return Err(AppError::NotFound);
    }
    sse_snapshot(&state, einsatz_id, sid);
    Ok(StatusCode::NO_CONTENT)
}
