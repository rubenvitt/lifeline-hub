//! Antwort-Umschlag des Fachebenen-Aggregators und Hilfsbuilder.

use serde::Serialize;
use serde_json::{json, Value};

/// Status einer Fachebenen-Antwort.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FachebeneStatus {
    /// Daten vorhanden (frisch oder aus gültigem Cache).
    Ok,
    /// Quelle erreichbar, aber keine Features.
    Leer,
    /// Quelle/Netz nicht erreichbar; Ebene wird ausgegraut.
    Offline,
}

/// Einheitlicher Umschlag für jede Fachebene.
#[derive(Debug, Clone, Serialize)]
pub struct FachebeneAntwort {
    pub quelle: String,
    pub status: FachebeneStatus,
    pub attribution: String,
    pub stand: Option<String>,
    /// GeoJSON FeatureCollection.
    pub features: Value,
}

/// Leere FeatureCollection.
pub fn leere_collection() -> Value {
    json!({ "type": "FeatureCollection", "features": [] })
}

impl FachebeneAntwort {
    /// Erfolg mit Features. `status` wird automatisch `leer`, wenn 0 Features.
    pub fn ok(quelle: &str, attribution: &str, stand: Option<String>, features: Value) -> Self {
        let leer = features
            .get("features")
            .and_then(|f| f.as_array())
            .map(|a| a.is_empty())
            .unwrap_or(true);
        FachebeneAntwort {
            quelle: quelle.to_string(),
            status: if leer {
                FachebeneStatus::Leer
            } else {
                FachebeneStatus::Ok
            },
            attribution: attribution.to_string(),
            stand,
            features,
        }
    }

    /// Quelle nicht erreichbar → leer + Offline-Status (HTTP bleibt 200).
    pub fn offline(quelle: &str, attribution: &str) -> Self {
        FachebeneAntwort {
            quelle: quelle.to_string(),
            status: FachebeneStatus::Offline,
            attribution: attribution.to_string(),
            stand: None,
            features: leere_collection(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok_mit_features_ist_ok() {
        let fc = json!({ "type": "FeatureCollection", "features": [ { "type": "Feature" } ] });
        let a = FachebeneAntwort::ok("dwd", "X", None, fc);
        assert_eq!(a.status, FachebeneStatus::Ok);
    }

    #[test]
    fn ok_ohne_features_ist_leer() {
        let a = FachebeneAntwort::ok("dwd", "X", None, leere_collection());
        assert_eq!(a.status, FachebeneStatus::Leer);
    }

    #[test]
    fn offline_hat_leere_collection() {
        let a = FachebeneAntwort::offline("nina", "BBK");
        assert_eq!(a.status, FachebeneStatus::Offline);
        assert_eq!(a.features["features"].as_array().unwrap().len(), 0);
    }

    #[test]
    fn status_serialisiert_lowercase() {
        assert_eq!(
            serde_json::to_string(&FachebeneStatus::Offline).unwrap(),
            "\"offline\""
        );
    }
}
