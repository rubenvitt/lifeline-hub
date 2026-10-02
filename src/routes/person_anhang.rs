//! Routen der Personen-Anhänge (LFH-757, Muster `routes::tier_anhang`; Liste, Ablage und
//! Soft-Delete im Kern `anhang::erfassung`). Gates strukturell über
//! die Extractor-Typen: `EinsatzLesezugriff<Personen>` (alle Mitglieder inkl. Beobachter, Modul
//! Personen frei — wie die Detailansicht), `EinsatzSchreibzugriff<Personen>` (Schreibrecht +
//! aktiver Einsatz).
//!
//! `{aid}` ist die Linker-id (`einsatz_person_anhang.id`), nicht `anhang.id`.
//!
//! **Lese-Audit je Download** (Spec `personen-anhaenge`, design.md D3): [`datei`] schreibt nach
//! allen Abweisungen und VOR der Auslieferung eine Zeile `anhang` ins Zugriffsprotokoll der
//! Person — auch für ein 304 und für das Original. Die Liste schreibt keine.

use axum::extract::{Multipart, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;

use crate::anhang;
use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Personen;
use crate::error::AppError;
use crate::extract::PfadParam;
use crate::person::anhang::{self as person_anhang, Ablage, PersonAnhangAnzeige};
use crate::person::{audit_repo, repo as person_repo};

use super::einsatz_person::sse_person;
use super::support::{anhang_antwort, genau_eine_datei, original_freigeben, Fassung, FassungParam};

/// GET /api/einsaetze/{id}/personen/{pid}/anhaenge — lebende Anhänge, neueste zuerst. Eine
/// stornierte Person bleibt lesbar; eine Person eines anderen Einsatzes ist 404. Kein Audit.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Personen>,
    PfadParam((_einsatz_id, person_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<PersonAnhangAnzeige>>, AppError> {
    Ok(Json(
        person_anhang::liste(&state.pool, ctx.einsatz.id, person_id).await?,
    ))
}

/// POST /api/einsaetze/{id}/personen/{pid}/anhaenge — eine Datei ablegen (Multipart, Feld
/// `datei`). Reihenfolge wie am Schaden: Gate (403/409) → Person im Einsatz (404) → storniert
/// (409) → Datei lesen (400) → Typ, Größe, Scan (400/422/503) → EINE Transaktion aus Anhang,
/// Linker und ETB-Nachweis (Storno dort erneut geprüft).
pub async fn ablegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personen>,
    PfadParam((_einsatz_id, person_id)): PfadParam<(i64, i64)>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<PersonAnhangAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let person = person_repo::laden(&state.pool, einsatz_id, person_id).await?;
    if person.storniert_at.is_some() {
        return Err(person_anhang::storniert());
    }
    let (dateiname, daten) = genau_eine_datei(&mut multipart).await?;
    let mime =
        anhang::pruefe_vor_persist(&dateiname, &daten, anhang::ERLAUBTE_MIME_ERFASSUNG).await?;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let (id, etb_id) = person_anhang::ablegen(
        &state.pool,
        einsatz_id,
        person_id,
        ctx.benutzer.id,
        startwert,
        &Ablage {
            dateiname: &dateiname,
            mime: &mime,
            daten: &daten,
        },
    )
    .await?;
    // Nach dem Commit: ETB (ID-only) und `person` (nur Kennungen, modulgefiltert).
    state.live.publiziere(einsatz_id, etb_id);
    sse_person(&state, einsatz_id, person_id);
    Ok((
        StatusCode::CREATED,
        Json(person_anhang::laden(&state.pool, einsatz_id, person_id, id).await?),
    ))
}

/// GET /api/einsaetze/{id}/personen/{pid}/anhaenge/{aid}/datei — Download (ETag/304) mit
/// Lese-Audit. Reihenfolge (design.md D3): Fassung (400) → Linker-Lookup als Zugriffsprüfung
/// (404) → beim Original die Freigabe (403, sonst ETB-Vermerk) → Audit-Zeile → Auslieferung.
/// Scheitert die Audit-Zeile, endet der Handler mit dem Fehler, ohne Bytes.
pub async fn datei(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Personen>,
    PfadParam((_einsatz_id, person_id, id)): PfadParam<(i64, i64, i64)>,
    param: FassungParam,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let fassung = param.fassung()?;
    let anhang_id =
        person_anhang::anhang_id_fuer_download(&state.pool, einsatz_id, person_id, id).await?;
    if fassung == Fassung::Original {
        let person = person_repo::laden(&state.pool, einsatz_id, person_id).await?;
        let ablage = person_anhang::ablage_name(person.registrier_nr);
        original_freigeben(&state, &ctx, anhang_id, &ablage).await?;
    }
    audit_repo::anlegen(
        &state.pool,
        einsatz_id,
        Some(person_id),
        ctx.benutzer.id,
        "anhang",
    )
    .await?;
    anhang_antwort(&state.pool, anhang_id, &req_headers, fassung).await
}

/// DELETE /api/einsaetze/{id}/personen/{pid}/anhaenge/{aid} — Soft-Delete mit ETB-Nachweis.
/// Die Datei bleibt bis zur Schwärzung gespeichert.
pub async fn entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Personen>,
    PfadParam((_einsatz_id, person_id, id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let etb_id = person_anhang::entfernen(
        &state.pool,
        einsatz_id,
        person_id,
        id,
        ctx.benutzer.id,
        startwert,
    )
    .await?;
    state.live.publiziere(einsatz_id, etb_id);
    sse_person(&state, einsatz_id, person_id);
    Ok(StatusCode::NO_CONTENT)
}
