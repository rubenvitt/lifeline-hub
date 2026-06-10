//! Reine Normalisierungs-Funktionen (rohe Quell-Antwort → GeoJSON-FeatureCollection).
//! Pro Quelle in den jeweiligen Phasen befüllt.

use serde_json::{json, Value};

/// PEGELONLINE `stations.json` → GeoJSON-Points. Jede Station mit `longitude`/`latitude`
/// wird zu einem Punkt; aktueller Wasserstand (falls vorhanden) als `wert`/`einheit`.
pub fn normalisiere_pegelonline(roh: &Value) -> Value {
    let stationen = roh.as_array().cloned().unwrap_or_default();
    let features: Vec<Value> = stationen
        .iter()
        .filter_map(|st| {
            let lon = st.get("longitude")?.as_f64()?;
            let lat = st.get("latitude")?.as_f64()?;
            let name = st
                .get("longname")
                .or_else(|| st.get("shortname"))
                .and_then(|v| v.as_str())
                .unwrap_or("Pegel");
            let messung = st
                .get("currentMeasurement")
                .and_then(|m| m.get("value"))
                .and_then(|v| v.as_f64());
            let einheit = st.get("unit").and_then(|v| v.as_str()).unwrap_or("");
            Some(json!({
                "type": "Feature",
                "geometry": { "type": "Point", "coordinates": [lon, lat] },
                "properties": {
                    "titel": name,
                    "kategorie": "pegel",
                    "wert": messung,
                    "einheit": einheit
                }
            }))
        })
        .collect();
    json!({ "type": "FeatureCollection", "features": features })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baut_punkt_aus_station() {
        let roh = json!([
            { "longname": "KÖLN", "longitude": 6.96, "latitude": 50.94, "unit": "cm",
              "currentMeasurement": { "value": 320.0 } }
        ]);
        let fc = normalisiere_pegelonline(&roh);
        let f = &fc["features"][0];
        assert_eq!(f["geometry"]["coordinates"][0], 6.96);
        assert_eq!(f["properties"]["titel"], "KÖLN");
        assert_eq!(f["properties"]["kategorie"], "pegel");
        assert_eq!(f["properties"]["wert"], 320.0);
    }

    #[test]
    fn station_ohne_koordinate_wird_uebersprungen() {
        let roh = json!([{ "longname": "X" }]);
        let fc = normalisiere_pegelonline(&roh);
        assert_eq!(fc["features"].as_array().unwrap().len(), 0);
    }
}
