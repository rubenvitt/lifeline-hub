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
            let zustand = cm
                .and_then(|m| m.get("stateMnwMhw"))
                .and_then(|v| v.as_str());
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
        // WICHTIG: serde_json sortiert Objekt-Schlüssel alphabetisch (BTreeMap), d. h.
        // `values().next()` lieferte "ar" (Arabisch) vor "de". Daher gezielt Deutsch wählen.
        let titel = info
            .and_then(|w| w.get("i18nTitle"))
            .and_then(|t| t.as_object())
            .and_then(|o| o.get("de").or_else(|| o.values().next()))
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

/// Hochwasserklasse des LHP als Wire-Wert.
///
/// Die Klassenlehre stammt aus dem Portal selbst (`js/lage-basics.js`, Kopfkommentar von
/// `getColorLagePegel`): `-1` keine Daten/veraltet · `0` kein Hochwasser · `1` kleines ·
/// `2` mittleres · `3` großes · `4` sehr großes Hochwasser. `UNK = 1` kennzeichnet einen
/// Pegel, der GAR KEINE Meldeklassen führt — ohne Daten (`HW = -1`) bleibt aber „keine
/// Daten" die stärkere Aussage, sonst sähe ein veralteter Pegel aus wie ein bloß
/// unklassifizierter.
///
/// Diese Zeichenketten sind der Wire-Vertrag zu `frontend/src/api/fachebenen.ts`
/// (`HochwasserKlasse`) und dort byte-gepinnt. Sie stehen in KEINEM OpenAPI-Schema:
/// Fachebenen-Properties sind `HashMap<String, Value>`, ein registriertes Enum wäre eine
/// Waise, auf die nichts zeigt. Deshalb sind die Literale hier UND dort gepinnt.
fn hochwasser_klasse(hw: Option<&str>, unklassifiziert: bool) -> &'static str {
    match hw {
        Some("-1") => "keine_daten",
        _ if unklassifiziert => "unklassifiziert",
        Some("0") => "kein_hochwasser",
        Some("1") => "klein",
        Some("2") => "mittel",
        Some("3") => "gross",
        Some("4") => "sehr_gross",
        // Klassifizierter Pegel ohne Klasse: „keine Daten" statt einer erfundenen Stufe.
        _ => "keine_daten",
    }
}

/// LHP `get_lagepegel.php` (Struct-of-Arrays) → GeoJSON-Punkte je Pegel.
///
/// Die Antwort ist KEINE Liste von Objekten, sondern sechs gleich lange Arrays
/// (`PGNAME`/`PGNR`/`HW`/`UNK`/`LAT`/`LON`), die über den Index zusammengehören.
/// LAT/LON kommen als Zeichenketten und werden hier zu Zahlen — ein String-Paar ist
/// kein gültiges GeoJSON, und MapLibre zeichnet es kommentarlos nicht.
pub fn normalisiere_hochwasser(roh: &Value) -> Value {
    let spalte = |name: &str| roh.get(name).and_then(|v| v.as_array());
    let (Some(pgnr), Some(lat), Some(lon)) = (spalte("PGNR"), spalte("LAT"), spalte("LON")) else {
        return json!({ "type": "FeatureCollection", "features": [] });
    };
    let name = spalte("PGNAME");
    let hw = spalte("HW");
    let unk = spalte("UNK");
    // Nur so weit laufen, wie ALLE Pflichtspalten reichen — eine verkürzte Spalte darf
    // keine Zeile an die falschen Koordinaten heften.
    let n = pgnr.len().min(lat.len()).min(lon.len());
    let zahl = |v: Option<&Value>| -> Option<f64> {
        match v? {
            Value::Number(z) => z.as_f64(),
            Value::String(s) => s.trim().parse::<f64>().ok(),
            _ => None,
        }
    };
    let text = |sp: Option<&Vec<Value>>, i: usize| -> Option<String> {
        sp?.get(i).and_then(|v| v.as_str()).map(str::to_string)
    };
    let features: Vec<Value> = (0..n)
        .filter_map(|i| {
            let (lon, lat) = (zahl(lon.get(i))?, zahl(lat.get(i))?);
            let nummer = pgnr.get(i).and_then(|v| v.as_str()).unwrap_or_default();
            let titel = text(name, i)
                .filter(|t| !t.trim().is_empty())
                .unwrap_or_else(|| format!("Pegel {nummer}"));
            let unklassifiziert = text(unk, i).as_deref() == Some("1");
            let klasse = hochwasser_klasse(
                hw.and_then(|sp| sp.get(i)).and_then(|v| v.as_str()),
                unklassifiziert,
            );
            Some(json!({
                "type": "Feature",
                "geometry": { "type": "Point", "coordinates": [lon, lat] },
                "properties": {
                    "titel": titel,
                    "kategorie": "hochwasser",
                    "pgnr": nummer,
                    "klasse": klasse
                }
            }))
        })
        .collect();
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
    fn waehlt_deutschen_titel_trotz_alphabetischer_schluessel() {
        // serde_json sortiert Keys alphabetisch → "ar" käme vor "de"; wir wollen Deutsch.
        let map_data = json!([
            { "id": "abc", "i18nTitle": { "ar": "تحذير", "de": "Stromausfall", "en": "Power outage" } }
        ]);
        let geo = json!({ "type": "FeatureCollection", "features": [
            { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [[[0,0],[1,0],[1,1],[0,0]]] } }
        ]});
        let fc = kombiniere_nina(&map_data, &[("abc".to_string(), geo)]);
        assert_eq!(fc["features"][0]["properties"]["titel"], "Stromausfall");
    }

    #[test]
    fn ueberspringt_features_ohne_geometrie() {
        let map_data = json!([{ "id": "x" }]);
        let geo = json!({ "type": "FeatureCollection", "features": [ { "type": "Feature", "geometry": null } ] });
        let fc = kombiniere_nina(&map_data, &[("x".to_string(), geo)]);
        assert_eq!(fc["features"].as_array().unwrap().len(), 0);
    }

    /// LFH-265: Der Schema-Anker `GeoJsonFeatureCollection` muss die TATSÄCHLICH produzierte
    /// Form beschreiben — sonst lügt `types.generated.ts` über die Fachebenen-Antwort.
    /// Beleg per Deserialisierung des echten Normalisierer-Outputs (ein `to_value`-Roundtrip
    /// über `FachebeneAntwort::ok` prüfte nur den Test-Eigeninput).
    #[test]
    fn nina_output_passt_auf_den_geojson_anker() {
        let map_data = json!([
            { "id": "abc", "severity": "Severe", "urgency": "Immediate", "type": "Update",
              "startDate": "2026-06-09T10:00:00+02:00", "i18nTitle": { "de": "Hochwasser" } }
        ]);
        let geo = json!({ "type": "FeatureCollection", "features": [
            { "type": "Feature", "geometry": { "type": "Polygon", "coordinates": [[[0,0],[1,0],[1,1],[0,0]]] } }
        ]});
        let fc = kombiniere_nina(&map_data, &[("abc".to_string(), geo)]);
        serde_json::from_value::<crate::karte::typen::GeoJsonFeatureCollection>(fc)
            .expect("Anker beschreibt die reale NINA-Form");
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

    /// LFH-265: siehe `nina_output_passt_auf_den_geojson_anker`.
    #[test]
    fn overpass_output_passt_auf_den_geojson_anker() {
        let roh = json!({ "elements": [ { "type": "node", "lon": 6.9, "lat": 50.9, "tags": {
            "amenity": "hospital", "name": "Klinik", "addr:street": "Hauptstr.", "addr:housenumber": "1",
            "operator": "Stadt Köln", "emergency": "yes"
        } } ] });
        serde_json::from_value::<crate::karte::typen::GeoJsonFeatureCollection>(
            normalisiere_overpass(&roh),
        )
        .expect("Anker beschreibt die reale Overpass-Form");
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

    /// LFH-265: siehe `nina_output_passt_auf_den_geojson_anker`.
    #[test]
    fn pegelonline_output_passt_auf_den_geojson_anker() {
        let roh = json!([
            {
                "longname": "KÖLN", "longitude": 6.96, "latitude": 50.94, "km": 688.0,
                "water": { "longname": "RHEIN" },
                "timeseries": [
                    { "shortname": "W", "unit": "cm",
                      "currentMeasurement": { "value": 320.0, "timestamp": "2026-06-10T10:30:00+02:00", "stateMnwMhw": "hoch" } }
                ]
            }
        ]);
        serde_json::from_value::<crate::karte::typen::GeoJsonFeatureCollection>(
            normalisiere_pegelonline(&roh),
        )
        .expect("Anker beschreibt die reale PEGELONLINE-Form");
    }

    /// LFH-265: auch die Leer-Antwort (jede `FachebeneAntwort::offline`) muss auf den Anker passen.
    #[test]
    fn leere_collection_passt_auf_den_geojson_anker() {
        serde_json::from_value::<crate::karte::typen::GeoJsonFeatureCollection>(
            crate::karte::typen::leere_collection(),
        )
        .expect("Anker beschreibt die leere FeatureCollection");
    }
}

#[cfg(test)]
mod hochwasser_tests {
    use super::*;

    /// Ausschnitt einer echten `get_lagepegel.php`-Antwort (abgerufen 20.09.2026):
    /// Struct-of-Arrays, LAT/LON als Zeichenketten, `HW` teils `null`.
    fn roh() -> Value {
        json!({
            "PGNAME": ["Wittenberge / Elbe", "Wiesloch / Leimbach", "Hohensaaten West AP / Havel-Oder-Wasserstrasse"],
            "PGNR": ["BB_503050", "BW_108", "BB_603400"],
            "HW": ["0", null, "-1"],
            "UNK": ["0", "1", "1"],
            "LAT": ["52.9855", "49.2920", "52.8767"],
            "LON": ["11.7594", "8.6791", "14.1518"]
        })
    }

    fn feature(fc: &Value, i: usize) -> &Value {
        &fc["features"][i]
    }

    #[test]
    fn baut_punkte_aus_den_parallel_arrays() {
        let fc = normalisiere_hochwasser(&roh());
        assert_eq!(fc["features"].as_array().unwrap().len(), 3);
        let f = feature(&fc, 0);
        assert_eq!(f["geometry"]["type"], "Point");
        // Koordinaten als ZAHLEN, nicht als Zeichenketten — GeoJSON verlangt das, und
        // MapLibre zeichnet einen String-Punkt stillschweigend gar nicht.
        assert_eq!(f["geometry"]["coordinates"], json!([11.7594, 52.9855]));
        assert_eq!(f["properties"]["titel"], "Wittenberge / Elbe");
        assert_eq!(f["properties"]["pgnr"], "BB_503050");
        assert_eq!(f["properties"]["kategorie"], "hochwasser");
    }

    #[test]
    fn bildet_die_hochwasserklassen_ab() {
        let roh = json!({
            "PGNAME": ["a", "b", "c", "d", "e", "f"],
            "PGNR": ["1", "2", "3", "4", "5", "6"],
            "HW": ["-1", "0", "1", "2", "3", "4"],
            "UNK": ["0", "0", "0", "0", "0", "0"],
            "LAT": ["50.0", "50.0", "50.0", "50.0", "50.0", "50.0"],
            "LON": ["8.0", "8.0", "8.0", "8.0", "8.0", "8.0"]
        });
        let fc = normalisiere_hochwasser(&roh);
        let klassen: Vec<&str> = fc["features"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["properties"]["klasse"].as_str().unwrap())
            .collect();
        assert_eq!(
            klassen,
            [
                "keine_daten",
                "kein_hochwasser",
                "klein",
                "mittel",
                "gross",
                "sehr_gross"
            ]
        );
    }

    #[test]
    fn unklassifizierter_pegel_mit_daten_ist_unklassifiziert() {
        let fc = normalisiere_hochwasser(&roh());
        assert_eq!(feature(&fc, 1)["properties"]["klasse"], "unklassifiziert");
    }

    #[test]
    fn unklassifizierter_pegel_ohne_daten_bleibt_keine_daten() {
        // UNK=1 UND HW=-1 → „unklassifiziert, keine Daten/veraltet" (LHP-Klassenlehre).
        // Die fehlenden Daten sind die stärkere Aussage; sonst sähe ein veralteter Pegel
        // aus wie einer, der bloß keine Meldestufen führt.
        let fc = normalisiere_hochwasser(&roh());
        assert_eq!(feature(&fc, 2)["properties"]["klasse"], "keine_daten");
    }

    #[test]
    fn ueberspringt_eintraege_ohne_brauchbare_koordinaten() {
        let roh = json!({
            "PGNAME": ["gut", "kaputt"],
            "PGNR": ["1", "2"],
            "HW": ["0", "0"],
            "UNK": ["0", "0"],
            "LAT": ["50.0", ""],
            "LON": ["8.0", "8.0"]
        });
        let fc = normalisiere_hochwasser(&roh);
        assert_eq!(fc["features"].as_array().unwrap().len(), 1);
        assert_eq!(feature(&fc, 0)["properties"]["titel"], "gut");
    }

    #[test]
    fn hochwasser_output_passt_auf_den_geojson_anker() {
        // `typen.rs` verspricht für `GeoJsonFeatureCollection`, der Anker sei „belegt durch
        // die `from_value`-Tests in `karte::normalisierung`" — jeder Normalisierer hält
        // diesen Teil des Versprechens selbst.
        serde_json::from_value::<crate::karte::typen::GeoJsonFeatureCollection>(
            normalisiere_hochwasser(&roh()),
        )
        .expect("Anker beschreibt die reale LHP-Form");
    }

    #[test]
    fn fremde_antwort_ergibt_leere_collection() {
        let fc = normalisiere_hochwasser(&json!({ "fehler": "Wartung" }));
        assert_eq!(fc["type"], "FeatureCollection");
        assert_eq!(fc["features"].as_array().unwrap().len(), 0);
    }
}
