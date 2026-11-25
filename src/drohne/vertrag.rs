//! Neutraler Drohnenvertrag. Kein Herstellername, keine Seriennummer: Kennungen sind eigene,
//! stabile Schlüssel (siehe [`key_for`]); die Zuordnung zum Upstream bleibt im Speicher.

use serde::Serialize;
use sha2::{Digest, Sha256};

/// Alles, was eine Drohnenquelle zu einem Zeitpunkt zeigt.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DrohnenLage {
    /// Zeit des Abrufs bei uns.
    pub stand_ms: i64,
    /// Zeit der Quelle laut ihrer Antwort.
    pub quelle_stand_ms: i64,
    pub mission_name: Option<String>,
    pub fluggeraete: Vec<Fluggeraet>,
    /// GeoJSON-`FeatureCollection` mit Eigenschaft `kind` (`track` | `element`).
    pub karte: Option<serde_json::Value>,
    pub videos: Vec<DrohnenVideo>,
    pub fotos: Vec<DrohnenFoto>,
    /// Karteneinträge, die wir nicht kennen und weggelassen haben.
    pub verworfen: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Fluggeraet {
    pub key: String,
    pub label: String,
    /// `[Längengrad, Breitengrad]` wie in GeoJSON.
    pub position: Option<[f64; 2]>,
    pub heading_deg: Option<f64>,
    /// Höhe über dem Startpunkt.
    pub height_m: Option<f64>,
    pub battery_percent: Option<u8>,
    pub airborne: bool,
}

/// Ein laufendes Livebild (nur HLS).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DrohnenVideo {
    pub key: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DrohnenFoto {
    pub key: String,
    pub taken_at_ms: i64,
    /// `[Längengrad, Breitengrad]`.
    pub position: [f64; 2],
    pub lens: String,
    pub heading_deg: Option<f64>,
    pub relative_altitude_m: Option<f64>,
}

/// Eigene Kennung: die ersten 16 Hex-Zeichen von SHA-256(`adapter_id:upstream`).
pub fn key_for(adapter_id: &str, upstream: &str) -> String {
    let digest = Sha256::digest(format!("{adapter_id}:{upstream}").as_bytes());
    digest[..8].iter().map(|b| format!("{b:02x}")).collect()
}
