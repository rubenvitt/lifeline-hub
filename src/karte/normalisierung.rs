//! Reine Normalisierungs-Funktionen (rohe Quell-Antwort → GeoJSON-FeatureCollection).
//! Pro Quelle in den jeweiligen Phasen befüllt.

use serde_json::{json, Value};

/// PEGELONLINE `stations.json` (mit `includeTimeseries`) → GeoJSON-Points. Der aktuelle
/// Wasserstand stammt aus der Zeitreihe `shortname == "W"` (Stationen führen mehrere
/// Reihen: W=Wasserstand, Q=Abfluss, …). Zusätzlich Gewässer, Stations-km, Zeitpunkt und
/// die fachliche Einordnung (`stateMnwMhw`: niedrig/normal/hoch).
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
            let gewaesser = st
                .get("water")
                .and_then(|w| w.get("longname"))
                .and_then(|v| v.as_str());
            let km = st.get("km").and_then(|v| v.as_f64());
            // Wasserstand-Zeitreihe heraussuchen.
            let w = st
                .get("timeseries")
                .and_then(|t| t.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .find(|ts| ts.get("shortname").and_then(|s| s.as_str()) == Some("W"))
                });
            let einheit = w.and_then(|ts| ts.get("unit")).and_then(|v| v.as_str());
            let cm = w.and_then(|ts| ts.get("currentMeasurement"));
            let wert = cm.and_then(|m| m.get("value")).and_then(|v| v.as_f64());
            let zeitpunkt = cm.and_then(|m| m.get("timestamp")).and_then(|v| v.as_str());
            let zustand = cm.and_then(|m| m.get("stateMnwMhw")).and_then(|v| v.as_str());
            Some(json!({
                "type": "Feature",
                "geometry": { "type": "Point", "coordinates": [lon, lat] },
                "properties": {
                    "titel": name,
                    "kategorie": "pegel",
                    "gewaesser": gewaesser,
                    "km": km,
                    "wert": wert,
                    "einheit": einheit,
                    "zeitpunkt": zeitpunkt,
                    "zustand": zustand
                }
            }))
        })
        .collect();
    json!({ "type": "FeatureCollection", "features": features })
}

/// Kombiniert die NINA-`mapData`-Liste (Metadaten je `id`) mit den separat geladenen
/// Einzel-Geometrien (`id` → GeoJSON-Value von `/warnings/{id}.geojson`) zu einer
/// FeatureCollection. Jede Warnung kann mehrere Features (Polygone) tragen. Beschreibungs-
/// texte liefert die NINA-`mapData`/`.geojson` nicht — daher Titel/Schwere/Dringlichkeit/
/// Typ/Beginn aus den Metadaten (das volle CAP-`.json` bewusst nicht zusätzlich geladen).
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

    let feld = |info: Option<&&Value>, key: &str| -> String {
        info.and_then(|w| w.get(key))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };

    let mut features: Vec<Value> = Vec::new();
    for (id, geo) in geometrien {
        let info = meta.get(id.as_str());
        let titel = info
            .and_then(|w| w.get("i18nTitle"))
            .and_then(|t| t.as_object())
            .and_then(|o| o.values().next())
            .and_then(|v| v.as_str())
            .unwrap_or("Warnung")
            .to_string();
        let schwere = feld(info, "severity");
        let dringlichkeit = feld(info, "urgency");
        let typ = feld(info, "type");
        let beginn = feld(info, "startDate");
        if let Some(arr) = geo.get("features").and_then(|f| f.as_array()) {
            for f in arr {
                let geometry = f.get("geometry").cloned().unwrap_or(Value::Null);
                if geometry.is_null() {
                    continue;
                }
                features.push(json!({
                    "type": "Feature",
                    "geometry": geometry,
                    "properties": {
                        "titel": titel,
                        "kategorie": "warnung",
                        "schwere": schwere,
                        "dringlichkeit": dringlichkeit,
                        "typ": typ,
                        "beginn": beginn,
                        "id": id
                    }
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
            { "id": "abc", "severity": "Severe", "urgency": "Immediate", "type": "Update",
              "startDate": "2026-06-09T10:00:00+02:00", "i18nTitle": { "de": "Hochwasser" } }
        ]);
        let geo = json!({ "type": "FeatureCollection", "features": [
            { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [[[0,0],[1,0],[1,1],[0,0]]] } }
        ]});
        let fc = kombiniere_nina(&map_data, &[("abc".to_string(), geo)]);
        let f = &fc["features"][0];
        assert_eq!(f["properties"]["titel"], "Hochwasser");
        assert_eq!(f["properties"]["schwere"], "Severe");
        assert_eq!(f["properties"]["dringlichkeit"], "Immediate");
        assert_eq!(f["properties"]["beginn"], "2026-06-09T10:00:00+02:00");
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
/// dank `out center`) → GeoJSON-Points. `kategorie` aus den Tags; zusätzlich Adresse,
/// Betreiber, Telefon, Website und (falls getaggt) Notaufnahme — alles als flache
/// Skalar-Properties (MapLibre stringifiziert verschachtelte Objekte beim Query).
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
            let g = |k: &str| tags.and_then(|t| t.get(k)).and_then(|v| v.as_str());
            let kategorie = kritis_kategorie(tags);
            let titel = g("name").unwrap_or_else(|| kategorie_label(&kategorie));
            let notaufnahme = match g("emergency") {
                Some("yes") => Some("ja"),
                Some("no") => Some("nein"),
                _ => None,
            };
            Some(json!({
                "type": "Feature",
                "geometry": { "type": "Point", "coordinates": [lon, lat] },
                "properties": {
                    "titel": titel,
                    "kategorie": kategorie,
                    "adresse": baue_adresse(tags),
                    "betreiber": g("operator"),
                    "telefon": g("phone").or_else(|| g("contact:phone")),
                    "website": g("website").or_else(|| g("contact:website")).or_else(|| g("url")),
                    "notaufnahme": notaufnahme
                }
            }))
        })
        .collect();
    json!({ "type": "FeatureCollection", "features": features })
}

/// Baut „Straße Hausnr., PLZ Ort" aus OSM-`addr:*`-Tags; None wenn nichts vorhanden.
fn baue_adresse(tags: Option<&serde_json::Map<String, Value>>) -> Option<String> {
    let g = |k: &str| tags.and_then(|t| t.get(k)).and_then(|v| v.as_str());
    let strasse = match (g("addr:street"), g("addr:housenumber")) {
        (Some(s), Some(h)) => Some(format!("{s} {h}")),
        (Some(s), None) => Some(s.to_string()),
        _ => None,
    };
    let ort = match (g("addr:postcode"), g("addr:city")) {
        (Some(p), Some(c)) => Some(format!("{p} {c}")),
        (None, Some(c)) => Some(c.to_string()),
        (Some(p), None) => Some(p.to_string()),
        _ => None,
    };
    match (strasse, ort) {
        (Some(s), Some(o)) => Some(format!("{s}, {o}")),
        (Some(s), None) => Some(s),
        (None, Some(o)) => Some(o),
        (None, None) => None,
    }
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
    #[test]
    fn reichert_adresse_und_kontakt_an() {
        let roh = json!({ "elements": [ { "type": "node", "lon": 6.9, "lat": 50.9, "tags": {
            "amenity": "hospital", "name": "Klinik", "addr:street": "Hauptstr.", "addr:housenumber": "1",
            "addr:postcode": "50667", "addr:city": "Köln", "operator": "Stadt Köln", "phone": "0221-1",
            "emergency": "yes"
        } } ] });
        let p = &normalisiere_overpass(&roh)["features"][0]["properties"];
        assert_eq!(p["adresse"], "Hauptstr. 1, 50667 Köln");
        assert_eq!(p["betreiber"], "Stadt Köln");
        assert_eq!(p["telefon"], "0221-1");
        assert_eq!(p["notaufnahme"], "ja");
    }
}

#[cfg(test)]
mod pegelonline_tests {
    use super::*;

    #[test]
    fn baut_punkt_aus_w_zeitreihe() {
        // Reale Struktur: currentMeasurement liegt unter timeseries[shortname=="W"].
        let roh = json!([
            {
                "longname": "KÖLN", "longitude": 6.96, "latitude": 50.94, "km": 688.0,
                "water": { "longname": "RHEIN" },
                "timeseries": [
                    { "shortname": "Q", "unit": "m³/s", "currentMeasurement": { "value": 2000.0 } },
                    { "shortname": "W", "unit": "cm",
                      "currentMeasurement": { "value": 320.0, "timestamp": "2026-06-10T10:30:00+02:00", "stateMnwMhw": "hoch" } }
                ]
            }
        ]);
        let fc = normalisiere_pegelonline(&roh);
        let f = &fc["features"][0];
        assert_eq!(f["geometry"]["coordinates"][0], 6.96);
        assert_eq!(f["properties"]["titel"], "KÖLN");
        assert_eq!(f["properties"]["kategorie"], "pegel");
        assert_eq!(f["properties"]["gewaesser"], "RHEIN");
        assert_eq!(f["properties"]["wert"], 320.0);
        assert_eq!(f["properties"]["einheit"], "cm");
        assert_eq!(f["properties"]["zustand"], "hoch");
    }

    #[test]
    fn station_ohne_koordinate_wird_uebersprungen() {
        let roh = json!([{ "longname": "X" }]);
        let fc = normalisiere_pegelonline(&roh);
        assert_eq!(fc["features"].as_array().unwrap().len(), 0);
    }
}
