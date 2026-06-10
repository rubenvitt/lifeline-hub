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

/// Kombiniert die NINA-`mapData`-Liste (Metadaten je `id`) mit den separat geladenen
/// Einzel-Geometrien (`id` → GeoJSON-Value von `/warnings/{id}.geojson`) zu einer
/// FeatureCollection. Jede Warnung kann mehrere Features (Polygone) tragen.
pub fn kombiniere_nina(map_data: &Value, geometrien: &[(String, Value)]) -> Value {
    use std::collections::HashMap;
    let meta: HashMap<&str, &Value> = map_data
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|w| w.get("id").and_then(|i| i.as_str()).map(|id| (id, w)))
                .collect()
        })
        .unwrap_or_default();

    let mut features: Vec<Value> = Vec::new();
    for (id, geo) in geometrien {
        let info = meta.get(id.as_str());
        let titel = info
            .and_then(|w| w.get("i18nTitle"))
            .and_then(|t| t.as_object())
            .and_then(|o| o.values().next())
            .and_then(|v| v.as_str())
            .unwrap_or("Warnung");
        let schwere = info
            .and_then(|w| w.get("severity"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if let Some(arr) = geo.get("features").and_then(|f| f.as_array()) {
            for f in arr {
                let geometry = f.get("geometry").cloned().unwrap_or(Value::Null);
                if geometry.is_null() {
                    continue;
                }
                features.push(json!({
                    "type": "Feature",
                    "geometry": geometry,
                    "properties": { "titel": titel, "kategorie": "warnung", "schwere": schwere, "id": id }
                }));
            }
        }
    }
    json!({ "type": "FeatureCollection", "features": features })
}

#[cfg(test)]
mod nina_tests {
    use super::*;

    #[test]
    fn kombiniert_meta_und_geometrie() {
        let map_data = json!([
            { "id": "abc", "severity": "Severe", "i18nTitle": { "de": "Hochwasser" } }
        ]);
        let geo = json!({ "type": "FeatureCollection", "features": [
            { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [[[0,0],[1,0],[1,1],[0,0]]] } }
        ]});
        let fc = kombiniere_nina(&map_data, &[("abc".to_string(), geo)]);
        let f = &fc["features"][0];
        assert_eq!(f["properties"]["titel"], "Hochwasser");
        assert_eq!(f["properties"]["schwere"], "Severe");
        assert_eq!(f["geometry"]["type"], "Polygon");
    }

    #[test]
    fn ueberspringt_features_ohne_geometrie() {
        let map_data = json!([{ "id": "x" }]);
        let geo = json!({ "type": "FeatureCollection", "features": [ { "type": "Feature", "geometry": null } ] });
        let fc = kombiniere_nina(&map_data, &[("x".to_string(), geo)]);
        assert_eq!(fc["features"].as_array().unwrap().len(), 0);
    }
}

/// Overpass-JSON (`elements` mit `lat`/`lon` bei Nodes bzw. `center` bei Ways/Relations,
/// dank `out center`) → GeoJSON-Points. `kategorie` wird aus den Tags abgeleitet.
pub fn normalisiere_overpass(roh: &Value) -> Value {
    let elemente = roh
        .get("elements")
        .and_then(|e| e.as_array())
        .cloned()
        .unwrap_or_default();
    let features: Vec<Value> = elemente
        .iter()
        .filter_map(|el| {
            let (lon, lat) = if let (Some(lon), Some(lat)) = (
                el.get("lon").and_then(|v| v.as_f64()),
                el.get("lat").and_then(|v| v.as_f64()),
            ) {
                (lon, lat)
            } else {
                let c = el.get("center")?;
                (c.get("lon")?.as_f64()?, c.get("lat")?.as_f64()?)
            };
            let tags = el.get("tags").and_then(|t| t.as_object());
            let kategorie = kritis_kategorie(tags);
            let titel = tags
                .and_then(|t| t.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or_else(|| kategorie_label(&kategorie));
            Some(json!({
                "type": "Feature",
                "geometry": { "type": "Point", "coordinates": [lon, lat] },
                "properties": { "titel": titel, "kategorie": kategorie }
            }))
        })
        .collect();
    json!({ "type": "FeatureCollection", "features": features })
}

fn kritis_kategorie(tags: Option<&serde_json::Map<String, Value>>) -> String {
    let g = |k: &str| tags.and_then(|t| t.get(k)).and_then(|v| v.as_str());
    if g("amenity") == Some("hospital") || g("amenity") == Some("clinic") {
        return "krankenhaus".into();
    }
    if g("amenity") == Some("nursing_home") || g("social_facility").is_some() {
        return "pflege".into();
    }
    if g("amenity") == Some("school") || g("amenity") == Some("kindergarten") {
        return "schule".into();
    }
    if g("man_made") == Some("water_works") || g("man_made") == Some("water_tower") {
        return "wasser".into();
    }
    if g("power") == Some("substation") {
        return "strom".into();
    }
    if g("amenity") == Some("fire_station") {
        return "feuerwehr".into();
    }
    if g("amenity") == Some("police") {
        return "polizei".into();
    }
    "kritis".into()
}

fn kategorie_label(k: &str) -> &'static str {
    match k {
        "krankenhaus" => "Krankenhaus",
        "pflege" => "Pflegeeinrichtung",
        "schule" => "Schule/Kita",
        "wasser" => "Wasserversorgung",
        "strom" => "Umspannwerk",
        "feuerwehr" => "Feuerwehr",
        "polizei" => "Polizei",
        _ => "KRITIS-Objekt",
    }
}

#[cfg(test)]
mod overpass_tests {
    use super::*;
    #[test]
    fn node_wird_punkt() {
        let roh = json!({ "elements": [ { "type": "node", "lon": 6.9, "lat": 50.9, "tags": { "amenity": "hospital", "name": "Uniklinik" } } ] });
        let fc = normalisiere_overpass(&roh);
        assert_eq!(fc["features"][0]["properties"]["kategorie"], "krankenhaus");
        assert_eq!(fc["features"][0]["properties"]["titel"], "Uniklinik");
    }
    #[test]
    fn way_mit_center_wird_punkt() {
        let roh = json!({ "elements": [ { "type": "way", "center": { "lon": 7.0, "lat": 51.0 }, "tags": { "power": "substation" } } ] });
        let fc = normalisiere_overpass(&roh);
        assert_eq!(fc["features"][0]["geometry"]["coordinates"][0], 7.0);
        assert_eq!(fc["features"][0]["properties"]["kategorie"], "strom");
        assert_eq!(fc["features"][0]["properties"]["titel"], "Umspannwerk");
    }
}

#[cfg(test)]
mod pegelonline_tests {
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
