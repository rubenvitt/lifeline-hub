//! Antwort-Umschlag des Fachebenen-Aggregators und Hilfsbuilder.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Status einer Fachebenen-Antwort.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// Bounding-Box in WGS84, Reihenfolge wie vom Frontend: west,sued,ost,nord.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bbox {
    pub west: f64,
    pub sued: f64,
    pub ost: f64,
    pub nord: f64,
}

impl Bbox {
    /// Parst "west,sued,ost,nord". Fehler → Err(Meldung).
    pub fn parse(s: &str) -> Result<Bbox, String> {
        let teile: Vec<f64> = s
            .split(',')
            .map(|t| t.trim().parse::<f64>())
            .collect::<Result<_, _>>()
            .map_err(|_| "bbox muss vier Zahlen sein".to_string())?;
        match teile.as_slice() {
            [west, sued, ost, nord] if west < ost && sued < nord => {
                if *sued < -90.0 || *nord > 90.0 || *west < -180.0 || *ost > 180.0 {
                    return Err("bbox-Koordinaten außerhalb des gültigen Bereichs".to_string());
                }
                if (ost - west) > 1.0 || (nord - sued) > 1.0 {
                    return Err("bbox zu groß — weiter hineinzoomen".to_string());
                }
                Ok(Bbox {
                    west: *west,
                    sued: *sued,
                    ost: *ost,
                    nord: *nord,
                })
            }
            _ => Err("bbox ungültig (west,sued,ost,nord)".to_string()),
        }
    }
    /// Overpass erwartet sued,west,nord,ost.
    pub fn overpass(&self) -> String {
        format!("{},{},{},{}", self.sued, self.west, self.nord, self.ost)
    }
    /// Cache-Schlüssel: auf 2 Nachkommastellen gerundet (≈1 km), reduziert Cache-Streuung.
    pub fn cache_key(&self) -> String {
        format!(
            "kritis:{:.2},{:.2},{:.2},{:.2}",
            self.west, self.sued, self.ost, self.nord
        )
    }
}

#[cfg(test)]
mod bbox_tests {
    use super::*;
    #[test]
    fn parst_gueltige_bbox() {
        let b = Bbox::parse("6.0,50.0,7.0,51.0").unwrap();
        assert_eq!(b.overpass(), "50,6,51,7");
    }
    #[test]
    fn lehnt_vertauschte_grenzen_ab() {
        assert!(Bbox::parse("7.0,50.0,6.0,51.0").is_err());
    }
    #[test]
    fn lehnt_unvollstaendig_ab() {
        assert!(Bbox::parse("1,2,3").is_err());
    }
    #[test]
    fn lehnt_koordinaten_ausserhalb_range_ab() {
        // Lon > 180
        assert!(Bbox::parse("185.0,50.0,186.0,51.0").is_err());
        // Lat > 90
        assert!(Bbox::parse("6.0,91.0,7.0,92.0").is_err());
        // Lat < -90
        assert!(Bbox::parse("6.0,-91.0,7.0,-89.0").is_err());
        // Lon < -180
        assert!(Bbox::parse("-181.0,50.0,-179.0,51.0").is_err());
    }
    #[test]
    fn lehnt_zu_grosse_bbox_ab() {
        // Ganz Deutschland: west=5, sued=47, ost=15, nord=55 → Δlon=10, Δlat=8
        assert!(Bbox::parse("5.0,47.0,15.0,55.0").is_err());
        // Lon-Spanne > 1
        assert!(Bbox::parse("6.0,50.0,7.5,50.9").is_err());
        // Lat-Spanne > 1
        assert!(Bbox::parse("6.0,50.0,6.9,51.5").is_err());
    }
    #[test]
    fn akzeptiert_bbox_mit_genau_einem_grad_spanne() {
        // Genau 1.0 Grad in jeder Richtung (nicht > 1.0) → Ok
        let b = Bbox::parse("6.0,50.0,7.0,51.0").unwrap();
        assert_eq!(b.west, 6.0);
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
