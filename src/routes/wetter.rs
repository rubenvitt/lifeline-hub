//! Route des Wetters am Einsatzort (LFH-633): `GET /api/einsaetze/{id}/wetter`.
//!
//! Gate `EinsatzLesezugriff<WetterPegel>`: ist das Modul „Wetter & Pegel“ ausgeblendet oder
//! gesperrt, antwortet die Route mit 403. Die Pegel-Routen bleiben modul-los.
//!
//! **Ein Quellausfall ist kein HTTP-Fehler**: Warnungen und Vorhersage tragen je einen
//! eigenen Zustand (`ok | kein_ort | ausfall`), die Antwort ist 200 — sonst risse der Ausfall
//! eines Teils den anderen mit. Ohne Koordinate des Einsatzorts gibt es keinen Abruf.
//!
//! **Kein Live-Ereignis**: das Frontend fragt alle 5 min nach, wie bei der Pegel-Kennzahl.

use axum::extract::State;
use axum::Json;

use crate::app::AppState;
use crate::einsatz::kontext::EinsatzLesezugriff;
use crate::einsatz::modul::WetterPegel;
use crate::error::AppError;
use crate::wetter::{abruf, WetterAnzeige};

/// GET /api/einsaetze/{id}/wetter — Warnungen der Warnzelle des Einsatzorts und Vorhersage
/// der nächsten 24 Stunden. Der Cache liegt im Nachschlage-Cache (eigene DB, Fallback auf den
/// operativen Pool — dieselbe Wahl wie `routes::pegel`).
pub async fn anzeige(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<WetterPegel>,
) -> Result<Json<WetterAnzeige>, AppError> {
    let ort = ctx.einsatz.einsatzort_lat.zip(ctx.einsatz.einsatzort_lon);
    let cache = crate::cache_db::cache_pool(&state.karten_dir).await;
    let cache_pool = cache.as_ref().unwrap_or(&state.pool);
    Ok(Json(
        abruf::anzeige(&state.fachebenen, cache_pool, ort, chrono::Utc::now()).await,
    ))
}
