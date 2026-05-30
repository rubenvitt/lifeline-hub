use crate::config::KarteConfig;
use axum::http::StatusCode;
use axum::{Extension, Json};
use serde::Serialize;

/// Antwort von `GET /api/karte/config`. Liefert NUR, was die Karte zur Laufzeit
/// braucht — NICHT den Server-Dateipfad der PMTiles-Datei.
#[derive(Debug, Serialize)]
pub struct KarteConfigAntwort {
    pub online_style_url: Option<String>,
    pub pmtiles_verfuegbar: bool,
    /// Relative URL des Tile-Endpoints, wenn eine PMTiles-Datei konfiguriert ist.
    pub pmtiles_url: Option<String>,
}

/// GET /api/karte/config — Basemap-Verfügbarkeit fürs Frontend.
pub async fn config(Extension(karte): Extension<KarteConfig>) -> Json<KarteConfigAntwort> {
    let pmtiles_verfuegbar = karte.pmtiles_path.is_some();
    Json(KarteConfigAntwort {
        online_style_url: karte.online_style_url.clone(),
        pmtiles_verfuegbar,
        pmtiles_url: pmtiles_verfuegbar.then(|| "/api/karte/tiles.pmtiles".to_string()),
    })
}

/// Fallback für `/api/karte/tiles.pmtiles`, wenn keine Datei konfiguriert ist → 404.
pub async fn tiles_fehlt() -> StatusCode {
    StatusCode::NOT_FOUND
}
