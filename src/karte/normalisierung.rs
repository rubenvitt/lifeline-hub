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

/// Obergrenze des natürlichen ODL-Bereichs in Deutschland laut BfS („zwischen 0,05 und
/// 0,2 Mikrosievert pro Stunde", ODL-Info, Messwertinterpretation). Inklusiv.
const ODL_NATUERLICH_BIS: f64 = 0.2;
/// 3 × Obergrenze. Angelehnt an den vom BfS genannten Faktor 3 — der dort aber
/// STANDORTBEZOGEN gemeint ist, nicht absolut.
const ODL_STARK_AB: f64 = 3.0 * ODL_NATUERLICH_BIS;
/// Einheit, in der die Bänder gerechnet sind — und die die Quelle für jede Sonde führt.
const ODL_EINHEIT: &str = "µSv/h";

/// Bewertungsstufe einer ODL-Sonde als Wire-Wert (LFH-78).
///
/// DIE BÄNDER SIND EINE PROJEKT-EINTEILUNG, KEINE BfS-SCHWELLE. Das BfS veröffentlicht
/// keinen absoluten Schwellenwert für „erhöht", sondern empfiehlt eine standortbezogene
/// Bewertung; ein Grundpegel je Sonde ist über die Schnittstelle aber nicht billig zu
/// haben (Zeitreihe = eine Sonde je Abruf, gemessen). Entschieden mit dem Menschen am
/// 21.09.2026; Herleitung in `docs/fachebenen-quellen.md`.
///
/// Die Zeichenketten sind der Wire-Vertrag zu `frontend/src/api/fachebenen.ts`
/// (`OdlStufe`) und wie bei [`hochwasser_klasse`] auf BEIDEN Seiten gepinnt.
fn odl_stufe(wert: Option<f64>) -> &'static str {
    match wert {
        None => "keine_messung",
        Some(w) if w <= ODL_NATUERLICH_BIS => "normal",
        Some(w) if w <= ODL_STARK_AB => "erhoeht",
        Some(_) => "stark_erhoeht",
    }
}

/// BfS-WFS `opendata:odlinfo_odl_1h_latest` (GeoJSON) → GeoJSON-Punkte je Sonde (LFH-78).
///
/// Die Quelle liefert bereits GeoJSON in EPSG:4326; normalisiert wird auf die gelesenen
/// Felder (~890 KB → ~358 KB). Sonden OHNE Messwert (defekt, Testbetrieb) bleiben drin:
/// eine ausgefallene Sonde ist in einer CBRN-Lage Information, kein Rauschen. Für sie
/// fehlen `wert` und `messende` ganz, statt als `null` zu erscheinen — dieselbe
/// Ehrlichkeit wie bei optionalen Response-Feldern (Norm ab LFH-265).
pub fn normalisiere_odl(roh: &Value) -> Value {
    let features: Vec<Value> = roh
        .get("features")
        .and_then(|f| f.as_array())
        .map(|liste| {
            liste
                .iter()
                .filter_map(|f| {
                    let koord = f.get("geometry")?.get("coordinates")?.as_array()?;
                    let (lon, lat) = (koord.first()?.as_f64()?, koord.get(1)?.as_f64()?);
                    let p = f.get("properties");
                    let text = |k: &str| {
                        p.and_then(|p| p.get(k))
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .filter(|t| !t.is_empty())
                    };
                    let wert = p.and_then(|p| p.get("value")).and_then(|v| v.as_f64());
                    let einheit = text("unit").unwrap_or(ODL_EINHEIT);
                    // Die Bänder sind in µSv/h gerechnet. Unter fremder Einheit wird NICHT
                    // bewertet — sonst stünde nach einer Umstellung auf nSv/h jede Sonde auf
                    // `stark_erhoeht`. Der Wert bleibt mit seiner Einheit sichtbar.
                    let stufe = if einheit == ODL_EINHEIT {
                        odl_stufe(wert)
                    } else {
                        "keine_messung"
                    };
                    let kennung = text("id").or_else(|| text("kenn"));
                    let mut props = serde_json::Map::new();
                    props.insert(
                        "titel".into(),
                        json!(text("name").map(str::to_string).unwrap_or_else(|| {
                            kennung.map_or("ODL-Sonde".into(), |k| format!("ODL-Sonde {k}"))
                        })),
                    );
                    props.insert("kategorie".into(), json!("odl"));
                    if let Some(k) = kennung {
                        props.insert("kennung".into(), json!(k));
                    }
                    props.insert("einheit".into(), json!(einheit));
                    props.insert("stufe".into(), json!(stufe));
                    if let Some(w) = wert {
                        props.insert("wert".into(), json!(w));
                    }
                    if let Some(m) = text("end_measure") {
                        props.insert("messende".into(), json!(m));
                    }
                    if let Some(b) = text("site_status_text") {
                        props.insert("betrieb".into(), json!(b));
                    }
                    Some(json!({
                        "type": "Feature",
                        "geometry": { "type": "Point", "coordinates": [lon, lat] },
                        "properties": props
                    }))
                })
                .collect()
        })
        .unwrap_or_default();
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

// ----------------------------------------------------------------------- AUTOBAHN

/// Dienstpfad der Autobahn-API → Kategorie dieser Fachebene. Der Antwort-Schlüssel ist bei
/// allen drei Diensten gleich dem Pfadsegment (`{"webcam":[…]}`, `{"roadworks":[…]}`,
/// `{"closure":[…]}` — gemessen), deshalb trägt `dienst` beides.
fn autobahn_kategorie(dienst: &str) -> Option<&'static str> {
    match dienst {
        "webcam" => Some("webcam"),
        "roadworks" => Some("baustelle"),
        "closure" => Some("sperrung"),
        _ => None,
    }
}

fn autobahn_label(kategorie: &str) -> &'static str {
    match kategorie {
        "webcam" => "Webcam",
        "baustelle" => "Baustelle",
        "sperrung" => "Sperrung",
        _ => "BAB-Lage",
    }
}

/// Eine Koordinate der Autobahn-API. Sie kommt je nach Dienst als **Zahl** (gemessen bei
/// `roadworks`/`closure`) oder als **String** (so das Beispiel der bundesAPI-Spec bei
/// `webcam`) — beide Formen müssen tragen, sonst fällt ein ganzer Dienst still weg.
fn autobahn_zahl(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }
}

/// `description` ist ein Array von Zeilen mit Leerzeilen als Absatztrenner. Leere Zeilen
/// fallen weg, der Rest wird zu einem Block; nichts Verwertbares → None.
fn autobahn_beschreibung(item: &Value) -> Option<String> {
    let zeilen: Vec<&str> = item
        .get("description")?
        .as_array()?
        .iter()
        .filter_map(|z| z.as_str())
        .map(|z| z.trim())
        .filter(|z| !z.is_empty())
        .collect();
    if zeilen.is_empty() {
        None
    } else {
        Some(zeilen.join("\n"))
    }
}

/// Autobahn-App-API → GeoJSON-Punkte. Eingabe ist je Eintrag `(strasse, dienst, antwort)`,
/// wobei `antwort` die rohe Dienst-Antwort ist (`{"<dienst>": [ … ]}`).
///
/// Zwei bewusste Verengungen, beide gemessen (LFH-80):
/// * **`future == true` fällt weg.** Die API führt auch noch nicht begonnene Maßnahmen
///   (3171 Baustellen gesamt gegen 1882 laufende am 20.09.2026). Für Anfahrt und
///   Lageaufklärung zählt der Ist-Zustand; eine Baustelle in drei Wochen ist Rauschen.
/// * **`isBlocked` wird NICHT übernommen.** Über alle 1950 laufenden Baustellen und
///   Sperrungen stand es ausnahmslos auf `"false"` — das Feld trägt keine Information,
///   und ein Merkmal, das immer „nein" sagt, führt am Einsatzplatz in die Irre.
///
/// Die **Geometrie der Quelle (`geometry`, LineString) wird bewusst verworfen**: der
/// Ticket-Zuschnitt sind Punkte, und die Linienzüge verdreifachen die Nutzlast.
pub fn normalisiere_autobahn(roh: &[(String, String, Value)]) -> Value {
    let mut features: Vec<Value> = Vec::new();
    for (strasse, dienst, antwort) in roh {
        let Some(kategorie) = autobahn_kategorie(dienst) else {
            continue;
        };
        let Some(items) = antwort.get(dienst).and_then(|v| v.as_array()) else {
            continue;
        };
        for item in items {
            if item.get("future").and_then(|f| f.as_bool()) == Some(true) {
                continue;
            }
            let koord = item.get("coordinate");
            let (Some(lon), Some(lat)) = (
                autobahn_zahl(koord.and_then(|c| c.get("long"))),
                autobahn_zahl(koord.and_then(|c| c.get("lat"))),
            ) else {
                continue;
            };
            let s = |k: &str| {
                item.get(k)
                    .and_then(|v| v.as_str())
                    .map(|v| v.trim())
                    .filter(|v| !v.is_empty())
            };
            let titel = s("title").unwrap_or_else(|| autobahn_label(kategorie));
            features.push(json!({
                "type": "Feature",
                "geometry": { "type": "Point", "coordinates": [lon, lat] },
                "properties": {
                    "titel": titel,
                    "kategorie": kategorie,
                    "strasse": strasse,
                    "richtung": s("subtitle"),
                    "beschreibung": autobahn_beschreibung(item),
                    "beginn": s("startTimestamp"),
                    "bild": s("imageurl"),
                    "link": s("linkurl"),
                    "betreiber": s("operator"),
                    "id": s("identifier")
                }
            }));
        }
    }
    json!({ "type": "FeatureCollection", "features": features })
}

#[cfg(test)]
mod autobahn_tests {
    use super::*;

    fn dienst(name: &str, items: Value) -> (String, String, Value) {
        ("A1".to_string(), name.to_string(), json!({ name: items }))
    }

    #[test]
    fn baustelle_wird_punkt_mit_strasse_und_richtung() {
        let roh = [dienst(
            "roadworks",
            json!([{
                "title": "A1 | Saarbrücken-Von-der-Heydt - Riegelsberg",
                "subtitle": " Saarbrücken -> Trier",
                "coordinate": { "lat": 49.2756, "long": 6.9623 },
                "description": ["Länge: 1.36 km", "", "Max. 80 km/h"],
                "identifier": "2026-047955",
                "future": false
            }]),
        )];
        let fc = normalisiere_autobahn(&roh);
        let f = &fc["features"][0];
        assert_eq!(f["geometry"]["type"], "Point");
        assert_eq!(f["geometry"]["coordinates"][0], 6.9623);
        assert_eq!(f["geometry"]["coordinates"][1], 49.2756);
        assert_eq!(f["properties"]["kategorie"], "baustelle");
        assert_eq!(f["properties"]["strasse"], "A1");
        // subtitle wird getrimmt — die API liefert ihn mit führendem Leerzeichen.
        assert_eq!(f["properties"]["richtung"], "Saarbrücken -> Trier");
        // Leerzeilen des description-Arrays fallen weg, der Rest wird ein Block.
        assert_eq!(
            f["properties"]["beschreibung"],
            "Länge: 1.36 km\nMax. 80 km/h"
        );
    }

    #[test]
    fn closure_wird_sperrung_und_webcam_bleibt_webcam() {
        let roh = [
            dienst(
                "closure",
                json!([{ "title": "A1 | Kamen", "coordinate": { "lat": 51.5, "long": 7.6 } }]),
            ),
            dienst(
                "webcam",
                json!([{ "title": "A1 | AK Köln-Nord", "coordinate": { "lat": 50.98, "long": 6.86 } }]),
            ),
        ];
        let fc = normalisiere_autobahn(&roh);
        let k: Vec<&str> = fc["features"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["properties"]["kategorie"].as_str().unwrap())
            .collect();
        assert_eq!(k, vec!["sperrung", "webcam"]);
    }

    /// Die Bild-URL der Webcam ist der Zweck dieser Ebene (LFH-80) — sie muss als Property
    /// ankommen, samt Betreiber und Videolink.
    #[test]
    fn webcam_traegt_bild_link_und_betreiber() {
        let roh = [dienst(
            "webcam",
            json!([{
                "title": "A1 | ID005 AK Köln-Nord",
                "subtitle": "Blickrichtung Dortmund",
                "coordinate": { "lat": "50.987423", "long": "6.861151" },
                "operator": "NRW",
                "imageurl": "https://www.verkehr.nrw/webcams/10108109881648294854.jpg",
                "linkurl": "https://www.blitzvideoserver.de/player.html?x=1"
            }]),
        )];
        let p = &normalisiere_autobahn(&roh)["features"][0]["properties"];
        assert_eq!(
            p["bild"],
            "https://www.verkehr.nrw/webcams/10108109881648294854.jpg"
        );
        assert_eq!(p["link"], "https://www.blitzvideoserver.de/player.html?x=1");
        assert_eq!(p["betreiber"], "NRW");
    }

    /// Gemessene Falle: `coordinate` kommt bei `roadworks`/`closure` als ZAHL, im
    /// Spec-Beispiel der Webcams als STRING. Trägt nur eine Form, fällt ein ganzer Dienst
    /// still weg — ohne Fehler, ohne roten Test, nur ohne Features.
    #[test]
    fn koordinate_traegt_als_zahl_und_als_string() {
        let als_zahl = [dienst(
            "closure",
            json!([{ "coordinate": { "lat": 51.5, "long": 7.6 } }]),
        )];
        let als_string = [dienst(
            "webcam",
            json!([{ "coordinate": { "lat": "51.5", "long": "7.6" } }]),
        )];
        for roh in [als_zahl, als_string] {
            let f = &normalisiere_autobahn(&roh)["features"][0];
            assert_eq!(f["geometry"]["coordinates"][0], 7.6);
            assert_eq!(f["geometry"]["coordinates"][1], 51.5);
        }
    }

    /// Noch nicht begonnene Maßnahmen sind für Anfahrt/Lageaufklärung Rauschen.
    #[test]
    fn future_eintraege_fallen_weg() {
        let roh = [dienst(
            "roadworks",
            json!([
                { "title": "läuft", "coordinate": { "lat": 51.0, "long": 7.0 }, "future": false },
                { "title": "später", "coordinate": { "lat": 51.1, "long": 7.1 }, "future": true }
            ]),
        )];
        let fc = normalisiere_autobahn(&roh);
        assert_eq!(fc["features"].as_array().unwrap().len(), 1);
        assert_eq!(fc["features"][0]["properties"]["titel"], "läuft");
    }

    /// `isBlocked` stand über alle 1950 gemessenen laufenden Einträge auf `"false"` — ein
    /// Merkmal ohne Information gehört nicht in die Karte. Die Gegenaussage ist die
    /// schärfere: sie fällt auf, wenn jemand das Feld „der Vollständigkeit halber" nachzieht.
    #[test]
    fn is_blocked_wird_nicht_uebernommen() {
        let roh = [dienst(
            "closure",
            json!([{ "coordinate": { "lat": 51.0, "long": 7.0 }, "isBlocked": "false" }]),
        )];
        let p = &normalisiere_autobahn(&roh)["features"][0]["properties"];
        assert!(
            p.get("gesperrt").is_none() && p.get("isBlocked").is_none(),
            "isBlocked trägt keine Information (gemessen) und darf nicht erscheinen"
        );
    }

    #[test]
    fn eintrag_ohne_koordinate_wird_uebersprungen() {
        let roh = [dienst("roadworks", json!([{ "title": "ohne Ort" }]))];
        assert_eq!(
            normalisiere_autobahn(&roh)["features"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
    }

    #[test]
    fn unbekannter_dienst_und_fehlender_schluessel_liefern_nichts() {
        let fremd = ("A1".to_string(), "parking_lorry".to_string(), json!({}));
        let leer = ("A1".to_string(), "closure".to_string(), json!({}));
        assert_eq!(
            normalisiere_autobahn(&[fremd, leer])["features"]
                .as_array()
                .unwrap()
                .len(),
            0
        );
    }

    #[test]
    fn titel_faellt_auf_die_kategorie_zurueck() {
        let roh = [dienst(
            "webcam",
            json!([{ "coordinate": { "lat": 51.0, "long": 7.0 } }]),
        )];
        assert_eq!(
            normalisiere_autobahn(&roh)["features"][0]["properties"]["titel"],
            "Webcam"
        );
    }

    /// LFH-265: siehe `nina_output_passt_auf_den_geojson_anker`.
    #[test]
    fn autobahn_output_passt_auf_den_geojson_anker() {
        let roh = [dienst(
            "roadworks",
            json!([{
                "title": "A1 | X", "subtitle": " Nord -> Süd",
                "coordinate": { "lat": 51.0, "long": 7.0 },
                "description": ["Länge: 1 km"], "identifier": "x"
            }]),
        )];
        serde_json::from_value::<crate::karte::typen::GeoJsonFeatureCollection>(
            normalisiere_autobahn(&roh),
        )
        .expect("Anker beschreibt die reale Autobahn-Form");
    }
}

#[cfg(test)]
mod odl_tests {
    use super::*;

    /// Ausschnitt einer echten `odlinfo_odl_1h_latest`-Antwort (abgerufen 21.09.2026), auf
    /// die gelesenen Felder gekürzt: eine Sonde in Betrieb, eine defekte und eine im
    /// Testbetrieb — die beiden letzten gemessen OHNE Wert und ohne Messende.
    fn roh() -> Value {
        json!({
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [12.87, 50.79] },
                    "properties": {
                        "id": "DEZ3068", "name": "Chemnitz", "site_status": 1,
                        "site_status_text": "in Betrieb", "end_measure": "2026-09-21T09:00:00Z",
                        "value": 0.115, "unit": "µSv/h"
                    }
                },
                {
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [10.63, 49.18] },
                    "properties": {
                        "id": "DEZ2345", "name": "Bechhofen", "site_status": 2,
                        "site_status_text": "defekt", "end_measure": null,
                        "value": null, "unit": "µSv/h"
                    }
                },
                {
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [9.1, 52.3] },
                    "properties": {
                        "id": "DEZ9001", "name": "Testsonde", "site_status": 3,
                        "site_status_text": "Testbetrieb", "value": null, "unit": "µSv/h"
                    }
                }
            ]
        })
    }

    fn sonde(wert: Value) -> Value {
        json!({
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [8.0, 50.0] },
            "properties": { "id": "X", "name": "x", "site_status": 1, "value": wert }
        })
    }

    fn stufe_zu(wert: Value) -> String {
        let fc = normalisiere_odl(&json!({ "features": [sonde(wert)] }));
        fc["features"][0]["properties"]["stufe"]
            .as_str()
            .unwrap()
            .to_string()
    }

    #[test]
    fn baut_punkte_mit_messwert() {
        let fc = normalisiere_odl(&roh());
        assert_eq!(fc["type"], "FeatureCollection");
        assert_eq!(fc["features"].as_array().unwrap().len(), 3);
        let f = &fc["features"][0];
        assert_eq!(
            f["geometry"],
            json!({ "type": "Point", "coordinates": [12.87, 50.79] })
        );
        let p = &f["properties"];
        assert_eq!(p["titel"], "Chemnitz");
        assert_eq!(p["kategorie"], "odl");
        assert_eq!(p["kennung"], "DEZ3068");
        assert_eq!(p["wert"], 0.115);
        assert_eq!(p["einheit"], "µSv/h");
        assert_eq!(p["messende"], "2026-09-21T09:00:00Z");
        assert_eq!(p["betrieb"], "in Betrieb");
        assert_eq!(p["stufe"], "normal");
    }

    #[test]
    fn sonde_ohne_messwert_bleibt_mit_eigener_stufe() {
        // Eine ausgefallene Sonde ist in einer CBRN-Lage eine Lücke im Lagebild — sie
        // wird nicht verworfen, sondern als „keine Messung" gezeigt.
        let fc = normalisiere_odl(&roh());
        for (i, betrieb) in [(1, "defekt"), (2, "Testbetrieb")] {
            let p = &fc["features"][i]["properties"];
            assert_eq!(p["stufe"], "keine_messung");
            assert_eq!(p["betrieb"], betrieb);
            let o = p.as_object().unwrap();
            // Presence statt `== Null`: ein fehlender Key und `null` sind beim
            // Index-Zugriff nicht unterscheidbar (CLAUDE.md, Typ-Codegen-Testfalle).
            assert!(!o.contains_key("wert"), "kein erfundener Messwert");
            assert!(!o.contains_key("messende"));
        }
    }

    #[test]
    fn baender_pinnen_die_wire_woerter_und_grenzen() {
        // Die Wörter sind der Vertrag zu `frontend/src/api/fachebenen.ts` (`OdlStufe`) und
        // stehen in keinem OpenAPI-Schema — deshalb hier wörtlich.
        assert_eq!(stufe_zu(json!(0.042)), "normal");
        assert_eq!(stufe_zu(json!(0.2)), "normal"); // BfS: „zwischen 0,05 und 0,2"
        assert_eq!(stufe_zu(json!(0.21)), "erhoeht");
        assert_eq!(stufe_zu(json!(0.6)), "erhoeht");
        assert_eq!(stufe_zu(json!(0.61)), "stark_erhoeht");
        assert_eq!(stufe_zu(Value::Null), "keine_messung");
        assert_eq!(stufe_zu(json!("0.3")), "keine_messung"); // kein Zahlwert → keine Bewertung
    }

    #[test]
    fn verwirft_features_ohne_brauchbare_geometrie() {
        let mut kaputt = sonde(json!(0.1));
        kaputt["geometry"] = json!({ "type": "Point", "coordinates": ["8", 50.0] });
        let mut ohne = sonde(json!(0.1));
        ohne["geometry"] = Value::Null;
        let fc = normalisiere_odl(&json!({ "features": [sonde(json!(0.1)), kaputt, ohne] }));
        assert_eq!(fc["features"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn fremde_einheit_wird_nicht_bewertet() {
        // Die Bänder sind µSv/h. Stellte die Quelle auf nSv/h um, stünde sonst jede Sonde
        // bundesweit auf `stark_erhoeht` — in einer CBRN-Lage der schlimmste Fehlalarm.
        let mut f = sonde(json!(115.0));
        f["properties"]["unit"] = json!("nSv/h");
        let fc = normalisiere_odl(&json!({ "features": [f] }));
        let p = &fc["features"][0]["properties"];
        assert_eq!(p["stufe"], "keine_messung");
        // Der Wert bleibt mit SEINER Einheit sichtbar — verworfen wird nur die Bewertung.
        assert_eq!(p["wert"], 115.0);
        assert_eq!(p["einheit"], "nSv/h");
    }

    #[test]
    fn fehlende_einheit_gilt_als_mikrosievert() {
        // Beobachtet trägt jede Sonde `unit`; fehlt es, ist µSv/h die dokumentierte Einheit.
        let fc = normalisiere_odl(&json!({ "features": [sonde(json!(0.7))] }));
        assert_eq!(fc["features"][0]["properties"]["stufe"], "stark_erhoeht");
        assert_eq!(fc["features"][0]["properties"]["einheit"], "µSv/h");
    }

    #[test]
    fn kennung_faellt_auf_kenn_zurueck_und_fehlt_sonst_ganz() {
        let mut mit_kenn = sonde(json!(0.1));
        mit_kenn["properties"] = json!({ "kenn": "141610002", "name": "Chemnitz", "value": 0.1 });
        let mut ohne = sonde(json!(0.1));
        ohne["properties"] = json!({ "value": 0.1 });
        let fc = normalisiere_odl(&json!({ "features": [mit_kenn, ohne] }));
        assert_eq!(fc["features"][0]["properties"]["kennung"], "141610002");
        let p = fc["features"][1]["properties"].as_object().unwrap();
        assert!(!p.contains_key("kennung"), "keine leere Kennung erfinden");
        assert_eq!(p["titel"], "ODL-Sonde");
    }

    #[test]
    fn formatbruch_ergibt_leere_collection() {
        for roh in [json!({}), json!([]), json!({ "features": "x" })] {
            let fc = normalisiere_odl(&roh);
            assert_eq!(fc, json!({ "type": "FeatureCollection", "features": [] }));
        }
    }
}
