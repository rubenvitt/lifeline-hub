//! Fetch-Logik je Quelle. Wird in den Phasen 2–5 befüllt.

use crate::error::AppError;
use crate::karte::normalisierung::normalisiere_pegelonline;
use crate::karte::typen::{leere_collection, FachebeneAntwort};
use crate::karte::FachebenenState;
use std::time::Duration;

const DWD_ATTRIB: &str = "Datenbasis: Deutscher Wetterdienst";
const DWD_TTL: Duration = Duration::from_secs(300);
// Vereinigte Warngebiete (weniger Features, bundesweit), als GeoJSON.
const DWD_URL: &str = "https://maps.dwd.de/geoserver/dwd/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=dwd:Warnungen_Gemeinden_vereinigt&outputFormat=application/json&srsName=EPSG:4326";

pub async fn fetch_dwd(s: &FachebenenState) -> FachebeneAntwort {
    if let Some(a) = s.cache.frisch("dwd", DWD_TTL) {
        return a;
    }
    match hole_geojson(s, DWD_URL).await {
        Ok(fc) => {
            let a = FachebeneAntwort::ok("dwd", DWD_ATTRIB, None, fc);
            s.cache.setze("dwd", a.clone());
            a
        }
        Err(e) => {
            tracing::warn!("DWD-Fetch fehlgeschlagen: {e}");
            s.cache
                .stale("dwd")
                .unwrap_or_else(|| FachebeneAntwort::offline("dwd", DWD_ATTRIB))
        }
    }
}

/// Holt eine externe URL und parst sie als GeoJSON-Value (FeatureCollection durchgereicht).
async fn hole_geojson(s: &FachebenenState, url: &str) -> Result<serde_json::Value, String> {
    let resp = s.client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    // Defensiv: nur FeatureCollections akzeptieren, sonst leer.
    if v.get("type").and_then(|t| t.as_str()) == Some("FeatureCollection") {
        Ok(v)
    } else {
        Ok(leere_collection())
    }
}

const PEGEL_ATTRIB: &str = "PEGELONLINE / WSV";
const PEGEL_TTL: Duration = Duration::from_secs(300);
const PEGEL_URL: &str = "https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?includeCurrentMeasurement=true";

pub async fn fetch_pegelonline(s: &FachebenenState) -> FachebeneAntwort {
    if let Some(a) = s.cache.frisch("pegelonline", PEGEL_TTL) {
        return a;
    }
    match hole_json(s, PEGEL_URL).await {
        Ok(roh) => {
            let fc = normalisiere_pegelonline(&roh);
            let a = FachebeneAntwort::ok("pegelonline", PEGEL_ATTRIB, None, fc);
            s.cache.setze("pegelonline", a.clone());
            a
        }
        Err(e) => {
            tracing::warn!("PEGELONLINE-Fetch fehlgeschlagen: {e}");
            s.cache
                .stale("pegelonline")
                .unwrap_or_else(|| FachebeneAntwort::offline("pegelonline", PEGEL_ATTRIB))
        }
    }
}

/// Holt eine URL und parst sie als beliebigen JSON-Value (nicht zwingend GeoJSON).
pub(crate) async fn hole_json(s: &FachebenenState, url: &str) -> Result<serde_json::Value, String> {
    let resp = s.client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

pub async fn fetch_nina(_s: &FachebenenState) -> FachebeneAntwort {
    FachebeneAntwort::offline("nina", "BBK / MoWaS")
}

pub async fn fetch_kritis(_s: &FachebenenState, _bbox: &str) -> Result<FachebeneAntwort, AppError> {
    Ok(FachebeneAntwort::offline(
        "kritis",
        "© OpenStreetMap-Beitragende",
    ))
}
