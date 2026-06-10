use crate::app::AppState;
use crate::config::{KarteConfig, OnlineStyle};
use crate::error::AppError;
use crate::karte::quellen;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::{Extension, Json};
use serde::Serialize;
use std::collections::HashMap;

/// Antwort von `GET /api/karte/config`. Liefert NUR, was die Karte zur Laufzeit
/// braucht — NICHT den Server-Dateipfad der PMTiles-Datei.
#[derive(Debug, Serialize)]
pub struct KarteConfigAntwort {
    pub online_styles: Vec<OnlineStyle>,
    pub pmtiles_verfuegbar: bool,
    /// Relative URL des Tile-Endpoints, wenn eine PMTiles-Datei konfiguriert ist.
    pub pmtiles_url: Option<String>,
}

/// GET /api/karte/config — Basemap-Verfügbarkeit fürs Frontend.
pub async fn config(Extension(karte): Extension<KarteConfig>) -> Json<KarteConfigAntwort> {
    let pmtiles_verfuegbar = karte.pmtiles_path.is_some();
    Json(KarteConfigAntwort {
        online_styles: karte.online_styles.clone(),
        pmtiles_verfuegbar,
        pmtiles_url: pmtiles_verfuegbar.then(|| "/api/karte/tiles.pmtiles".to_string()),
    })
}

/// Fallback für `/api/karte/tiles.pmtiles`, wenn keine Datei konfiguriert ist → 404.
pub async fn tiles_fehlt() -> StatusCode {
    StatusCode::NOT_FOUND
}

/// GET /api/karte/fachebenen/{quelle} — externe Lagedaten als GeoJSON-Umschlag.
pub async fn fachebenen(
    State(state): State<AppState>,
    Path(quelle): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<crate::karte::typen::FachebeneAntwort>, AppError> {
    let bbox = params.get("bbox").map(|s| s.as_str());
    let antwort = match quelle.as_str() {
        "dwd" => quellen::fetch_dwd(&state.fachebenen).await,
        "pegelonline" => quellen::fetch_pegelonline(&state.fachebenen).await,
        "nina" => quellen::fetch_nina(&state.fachebenen).await,
        "kritis" => {
            let bbox =
                bbox.ok_or_else(|| AppError::Validation("bbox-Parameter erforderlich".into()))?;
            quellen::fetch_kritis(&state.fachebenen, bbox).await?
        }
        _ => return Err(AppError::Validation(format!("Unbekannte Quelle: {quelle}"))),
    };
    Ok(Json(antwort))
}
