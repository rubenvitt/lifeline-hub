//! Fetch-Logik je Quelle. Wird in den Phasen 2–5 befüllt.

use crate::error::AppError;
use crate::karte::normalisierung::{
    kombiniere_nina, normalisiere_overpass, normalisiere_pegelonline,
};
use crate::karte::typen::{leere_collection, Bbox, FachebeneAntwort};
use crate::karte::FachebenenState;
use futures::stream::{self, StreamExt};
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
const PEGEL_URL: &str = "https://www.pegelonline.wsv.de/webservices/rest-api/v2/stations.json?includeTimeseries=true&includeCurrentMeasurement=true";

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

const NINA_ATTRIB: &str =
    "Quelle: Bundesamt für Bevölkerungsschutz und Katastrophenhilfe (BBK) / MoWaS";
const NINA_TTL: Duration = Duration::from_secs(90);
const NINA_MAPDATA: &str = "https://warnung.bund.de/api31/mowas/mapData.json";
fn nina_geojson_url(id: &str) -> String {
    format!("https://warnung.bund.de/api31/warnings/{id}.geojson")
}

pub async fn fetch_nina(s: &FachebenenState) -> FachebeneAntwort {
    if let Some(a) = s.cache.frisch("nina", NINA_TTL) {
        return a;
    }
    let map_data = match hole_json(s, NINA_MAPDATA).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!("NINA-mapData-Fetch fehlgeschlagen: {e}");
            return s
                .cache
                .stale("nina")
                .unwrap_or_else(|| FachebeneAntwort::offline("nina", NINA_ATTRIB));
        }
    };
    // IDs einsammeln und Geometrien parallel laden (N+1, begrenzt auf die aktuellen Warnungen).
    let ids: Vec<String> = map_data
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|w| w.get("id").and_then(|i| i.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let geometrien: Vec<(String, serde_json::Value)> = stream::iter(ids)
        .map(|id| {
            let url = nina_geojson_url(&id);
            async move {
                match hole_json(s, &url).await {
                    Ok(v) => Some((id, v)),
                    Err(e) => {
                        tracing::warn!("NINA-Geometrie-Fetch für {id} fehlgeschlagen: {e}");
                        None
                    }
                }
            }
        })
        .buffer_unordered(8)
        .collect::<Vec<_>>()
        .await
        .into_iter()
        .flatten()
        .collect();
    let fc = kombiniere_nina(&map_data, &geometrien);
    let a = FachebeneAntwort::ok("nina", NINA_ATTRIB, None, fc);
    s.cache.setze("nina", a.clone());
    a
}

const KRITIS_ATTRIB: &str = "© OpenStreetMap-Beitragende (ODbL)";
/// KRITIS-Objekte (Krankenhäuser, Schulen, Umspannwerke …) sind quasi statisch →
/// lange cachen (1 Tag). Entlastet Overpass deutlich.
const KRITIS_TTL: Duration = Duration::from_secs(24 * 3600);
/// Overpass braucht länger als das globale Client-Timeout (8 s) — interne `[timeout:25]`.
const KRITIS_TIMEOUT: Duration = Duration::from_secs(30);
/// Hauptinstanz ist oft überlastet (TimedOut) → Mirror als Fallback.
const OVERPASS_URLS: [&str; 2] = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
];

fn overpass_query(bbox_op: &str) -> String {
    format!(
        "[out:json][timeout:25];(\
nwr[amenity=hospital]({b});nwr[amenity=clinic]({b});nwr[amenity=nursing_home]({b});\
nwr[\"social_facility\"]({b});nwr[amenity=school]({b});nwr[amenity=kindergarten]({b});\
nwr[man_made=water_works]({b});nwr[man_made=water_tower]({b});nwr[power=substation]({b});\
nwr[amenity=fire_station]({b});nwr[amenity=police]({b}););out center tags;",
        b = bbox_op
    )
}

pub async fn fetch_kritis(
    s: &FachebenenState,
    bbox_roh: &str,
) -> Result<FachebeneAntwort, AppError> {
    let bbox = Bbox::parse(bbox_roh).map_err(AppError::Validation)?;
    let key = bbox.cache_key();
    if let Some(a) = s.cache.frisch(&key, KRITIS_TTL) {
        return Ok(a);
    }
    let query = overpass_query(&bbox.overpass());

    // Endpunkte der Reihe nach versuchen (eigenes, längeres Timeout). Einzelfehler nur auf
    // debug-Ebene — erst wenn ALLE Endpunkte scheitern, eine warn-Meldung (weniger Log-Rauschen).
    for url in OVERPASS_URLS {
        let resp = s
            .client
            .post(url)
            .timeout(KRITIS_TIMEOUT)
            .header("Content-Type", "text/plain")
            .body(query.clone())
            .send()
            .await;
        match resp {
            Ok(r) if r.status().is_success() => match r.json::<serde_json::Value>().await {
                Ok(roh) => {
                    let a = FachebeneAntwort::ok(
                        "kritis",
                        KRITIS_ATTRIB,
                        None,
                        normalisiere_overpass(&roh),
                    );
                    s.cache.setze(&key, a.clone());
                    return Ok(a);
                }
                Err(e) => tracing::debug!("Overpass-JSON-Parse ({url}) fehlgeschlagen: {e}"),
            },
            Ok(r) => tracing::debug!("Overpass ({url}) HTTP {}", r.status()),
            Err(e) => tracing::debug!("Overpass-Fetch ({url}) fehlgeschlagen: {e}"),
        }
    }

    tracing::warn!("Overpass nicht erreichbar (alle Endpunkte) — KRITIS aus Cache/leer");
    Ok(s
        .cache
        .stale(&key)
        .unwrap_or_else(|| FachebeneAntwort::offline("kritis", KRITIS_ATTRIB)))
}
