//! Route des Wetters am Einsatzort (LFH-633): `GET /api/einsaetze/{id}/wetter`.
//!
//! Gate `EinsatzLesezugriff<WetterPegel>`: ist das Modul ausgeblendet oder gesperrt → 403. Die
//! Pegel-Routen bleiben modul-los.
//!
//! **Ein Quellausfall ist kein HTTP-Fehler:** Warnungen und Vorhersage tragen je einen Zustand
//! (`ok | kein_ort | ausfall`), die Antwort ist 200, damit ein Ausfall nicht den anderen Teil
//! mitreißt. Ohne Koordinate des Einsatzorts kein Abruf. Kein Live-Ereignis; das Frontend fragt
//! alle 5 min.

use axum::extract::State;
use axum::Json;

use crate::app::AppState;
use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::einsatz::modul::WetterPegel;
use crate::error::AppError;
use crate::wetter::{abruf, WetterAnzeige};

/// GET /api/einsaetze/{id}/wetter — Warnungen der Warnzelle des Einsatzorts und Vorhersage der
/// nächsten 24 Stunden. Cache im Nachschlage-Cache mit Rückfall auf den operativen Pool (wie
/// `routes::pegel`).
pub async fn anzeige(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<WetterPegel>,
) -> Result<Json<WetterAnzeige>, AppError> {
    let ort = ctx.einsatz.einsatzort_lat.zip(ctx.einsatz.einsatzort_lon);
    let cache = crate::cache_db::cache_pool(&state.karten_dir).await;
    let cache_pool = cache.as_ref().unwrap_or(&state.pool);
    Ok(Json(
        abruf::anzeige(
            &state.fachebenen,
            cache_pool,
            ctx.einsatz.org_id,
            ort,
            chrono::Utc::now(),
        )
        .await,
    ))
}
