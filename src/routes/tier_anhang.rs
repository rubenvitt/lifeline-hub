//! Routen der Tier-Anhänge (LFH-758, Spec `tier-anhaenge`). Gates strukturell über die
//! Extractor-Typen: `EinsatzLesezugriff<Tiere>` (alle Mitglieder inkl. Beobachter, Modul Tiere
//! frei), `EinsatzSchreibzugriff<Tiere>` (Schreibrecht + aktiver Einsatz). Aufbau wie
//! `routes::schaden_anhang`; Liste, Ablage und Soft-Delete im Kern `anhang::erfassung`.
//!
//! `{aid}` ist die Linker-id (`einsatz_tier_anhang.id`), nicht `anhang.id`. Kein Lese-Audit.

use axum::extract::{Multipart, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::Json;

use crate::anhang;
use crate::anhang::erfassung::Ablage;
use crate::app::AppState;
use crate::einsatz::einstellungen::etb_startwert;
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Tiere;
use crate::error::AppError;
use crate::extract::PfadParam;
use crate::tier::anhang::{self as tier_anhang, TierAnhangAnzeige};
use crate::tier::repo as tier_repo;

use super::einsatz_tier::sse_tier;
use super::support::{anhang_antwort, genau_eine_datei, original_freigeben, Fassung, FassungParam};

/// GET /api/einsaetze/{id}/tiere/{tid}/anhaenge — lebende Anhänge, neueste zuerst.
/// Ein storniertes Tier bleibt lesbar; ein Tier eines anderen Einsatzes ist 404.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Tiere>,
    PfadParam((_einsatz_id, tier_id)): PfadParam<(i64, i64)>,
) -> Result<Json<Vec<TierAnhangAnzeige>>, AppError> {
    Ok(Json(
        tier_anhang::liste(&state.pool, ctx.einsatz.id, tier_id).await?,
    ))
}

/// POST /api/einsaetze/{id}/tiere/{tid}/anhaenge — eine Datei ablegen (Multipart, Feld
/// `datei`). Reihenfolge wie bei Schäden: Gate (403/409) → Tier im Einsatz (404) → storniert
/// (409) → Datei lesen (400) → Typ, Größe, Scan (400/422/503) → EINE Transaktion aus Anhang,
/// Linker und ETB-Nachweis (Storno dort erneut geprüft).
pub async fn ablegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Tiere>,
    PfadParam((_einsatz_id, tier_id)): PfadParam<(i64, i64)>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<TierAnhangAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let tier = tier_repo::laden(&state.pool, einsatz_id, tier_id).await?;
    if tier.storniert_at.is_some() {
        return Err(AppError::Conflict(
            tier_anhang::TIER_ABLAGE.storniert_meldung.into(),
        ));
    }
    let (dateiname, daten) = genau_eine_datei(&mut multipart).await?;
    let mime =
        anhang::pruefe_vor_persist(&dateiname, &daten, anhang::ERLAUBTE_MIME_ERFASSUNG).await?;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let (id, etb_id) = tier_anhang::ablegen(
        &state.pool,
        einsatz_id,
        tier_id,
        ctx.benutzer.id,
        startwert,
        &Ablage {
            dateiname: &dateiname,
            mime: &mime,
            daten: &daten,
        },
    )
    .await?;
    // Nach dem Commit: ETB (ID-only) und `tier` (nur Kennungen, modulgefiltert).
    state.live.publiziere(einsatz_id, etb_id);
    sse_tier(&state, einsatz_id, tier_id);
    Ok((
        StatusCode::CREATED,
        Json(tier_anhang::laden(&state.pool, einsatz_id, tier_id, id).await?),
    ))
}

/// GET /api/einsaetze/{id}/tiere/{tid}/anhaenge/{aid}/datei — Download (ETag/304). Der
/// Linker-Lookup IST die Zugriffsprüfung: fremder Einsatz, anderes Tier, unbekannt oder
/// entfernt → 404.
pub async fn datei(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Tiere>,
    PfadParam((_einsatz_id, tier_id, id)): PfadParam<(i64, i64, i64)>,
    param: FassungParam,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    let fassung = param.fassung()?;
    let anhang_id =
        tier_anhang::anhang_id_fuer_download(&state.pool, ctx.einsatz.id, tier_id, id).await?;
    if fassung == Fassung::Original {
        let tier = tier_repo::laden(&state.pool, ctx.einsatz.id, tier_id).await?;
        let ablage = tier_anhang::ablage_name(tier.registrier_nr);
        original_freigeben(&state, &ctx, anhang_id, &ablage).await?;
    }
    anhang_antwort(&state.pool, anhang_id, &req_headers, fassung).await
}

/// DELETE /api/einsaetze/{id}/tiere/{tid}/anhaenge/{aid} — Soft-Delete mit ETB-Nachweis.
/// Die Datei bleibt bis zur Schwärzung gespeichert.
pub async fn entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Tiere>,
    PfadParam((_einsatz_id, tier_id, id)): PfadParam<(i64, i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let startwert = etb_startwert(&state.pool, einsatz_id).await?;
    let etb_id = tier_anhang::entfernen(
        &state.pool,
        einsatz_id,
        tier_id,
        id,
        ctx.benutzer.id,
        startwert,
    )
    .await?;
    state.live.publiziere(einsatz_id, etb_id);
    sse_tier(&state, einsatz_id, tier_id);
    Ok(StatusCode::NO_CONTENT)
}
