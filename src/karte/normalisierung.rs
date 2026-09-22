//! Reine Normalisierungs-Funktionen (rohe Quell-Antwort → GeoJSON-FeatureCollection).
//! Pro Quelle in den jeweiligen Phasen befüllt.

use serde_json::{json, Value};

/// PEGELONLINE `stations.json` (mit `includeTimeseries`) → GeoJSON-Points. Der aktuelle
/// Wasserstand stammt aus der Zeitreihe `shortname == "W"` (Stationen führen mehrere
/// Reihen: W=Wasserstand, Q=Abfluss, …). Zusätzlich Gewässer, Stations-km, Zeitpunkt und
/// die fachliche Einordnung (`stateMnwMhw`: niedrig/normal/hoch). Die Stations-`uuid` geht
/// additiv mit (LFH-606): über sie legt ein Einsatz seinen maßgeblichen Pegel fest und
/// holt dessen Zeitreihe (`crate::pegel`).
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
            let uuid = st.get("uuid").and_then(|v| v.as_str());
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
                    "uuid": uuid,
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

/// Absolute Bewertungsstufe einer ODL-Sonde als Wire-Wert (LFH-78) — seit LFH-598 der
/// RÜCKFALL: liegt für die Sonde ein Standort-Grundpegel vor, überschreibt
/// `karte::odl_grundpegel::bewerte` diese Stufe bei Auslieferung mit der relativen.
///
/// DIE BÄNDER SIND EINE PROJEKT-EINTEILUNG, KEINE BfS-SCHWELLE. Das BfS veröffentlicht
/// keinen absoluten Schwellenwert für „erhöht", sondern empfiehlt eine standortbezogene
/// Bewertung. Die Bänder gelten, bis ein Grundpegel da ist (erster Start, zu wenig
/// Historie). Entschieden mit dem Menschen am 21.09.2026; Herleitung in
/// `docs/fachebenen-quellen.md`.
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

/// Tag-Paare, an denen ein OSM-Objekt als KRITIS-Objekt erkannt wird (LFH-83). Exakt die
/// Auswahl der früheren Overpass-Query; `social_facility` zählt mit JEDEM Wert (`None`).
/// Eine Quelle für Import-Filter und Kategorie — sonst könnte der Filter ein Objekt
/// durchlassen, dem die Kategorie dann nur noch „kritis" zuordnen kann.
pub const KRITIS_TAGS: [(&str, Option<&str>); 11] = [
    ("amenity", Some("hospital")),
    ("amenity", Some("clinic")),
    ("amenity", Some("nursing_home")),
    ("social_facility", None),
    ("amenity", Some("school")),
    ("amenity", Some("kindergarten")),
    ("man_made", Some("water_works")),
    ("man_made", Some("water_tower")),
    ("power", Some("substation")),
    ("amenity", Some("fire_station")),
    ("amenity", Some("police")),
];

/// True, wenn das Tag-Paar eines der [`KRITIS_TAGS`] ist — der billige Vorfilter beim
/// Lesen des Extrakts, bevor Tags in eine Map gesammelt werden.
pub fn ist_kritis_tag(k: &str, v: &str) -> bool {
    KRITIS_TAGS
        .iter()
        .any(|(tk, tv)| *tk == k && tv.is_none_or(|tv| tv == v))
}

/// OSM-Tags eines Objekts → flache KRITIS-Properties (`titel`, `kategorie`, `adresse`,
/// `betreiber`, `telefon`, `website`, `notaufnahme`); `None`, wenn kein KRITIS-Tag
/// gesetzt ist. Alles flache Skalare — MapLibre stringifiziert verschachtelte Objekte
/// beim Query.
pub fn kritis_properties<'a>(tag: impl Fn(&str) -> Option<&'a str>) -> Option<Value> {
    let kategorie = kritis_kategorie(&tag)?;
    let titel = tag("name").unwrap_or_else(|| kategorie_label(kategorie));
    let notaufnahme = match tag("emergency") {
        Some("yes") => Some("ja"),
        Some("no") => Some("nein"),
        _ => None,
    };
    Some(json!({
        "titel": titel,
        "kategorie": kategorie,
        "adresse": baue_adresse(&tag),
        "betreiber": tag("operator"),
        "telefon": tag("phone").or_else(|| tag("contact:phone")),
        "website": tag("website").or_else(|| tag("contact:website")).or_else(|| tag("url")),
        "notaufnahme": notaufnahme
    }))
}

/// Baut „Straße Hausnr., PLZ Ort" aus OSM-`addr:*`-Tags; None wenn nichts vorhanden.
fn baue_adresse<'a>(tag: &impl Fn(&str) -> Option<&'a str>) -> Option<String> {
    let strasse = match (tag("addr:street"), tag("addr:housenumber")) {
        (Some(s), Some(h)) => Some(format!("{s} {h}")),
        (Some(s), None) => Some(s.to_string()),
        _ => None,
    };
    let ort = match (tag("addr:postcode"), tag("addr:city")) {
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

/// Kategorie in fester Vorrangfolge (ein Objekt mit Krankenhaus- UND Pflege-Tag ist
/// Krankenhaus); `None` ohne KRITIS-Tag.
fn kritis_kategorie<'a>(tag: &impl Fn(&str) -> Option<&'a str>) -> Option<&'static str> {
    let amenity = tag("amenity");
    let man_made = tag("man_made");
    Some(match () {
        _ if matches!(amenity, Some("hospital" | "clinic")) => "krankenhaus",
        _ if amenity == Some("nursing_home") || tag("social_facility").is_some() => "pflege",
        _ if matches!(amenity, Some("school" | "kindergarten")) => "schule",
        _ if matches!(man_made, Some("water_works" | "water_tower")) => "wasser",
        _ if tag("power") == Some("substation") => "strom",
        _ if amenity == Some("fire_station") => "feuerwehr",
        _ if amenity == Some("police") => "polizei",
        _ => return None,
    })
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
mod kritis_tests {
    use super::*;
    use std::collections::HashMap;

    fn props(paare: &[(&str, &str)]) -> Option<Value> {
        let m: HashMap<String, String> = paare
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        kritis_properties(|k| m.get(k).map(String::as_str))
    }

    /// Jede der elf Tag-Kombinationen der früheren Overpass-Query → ihre Kategorie. Die
    /// Wörter sind Schnittstelle (Frontend `KATEGORIE_LABEL`) und hier wörtlich gepinnt.
    #[test]
    fn jede_tag_kombination_hat_ihre_kategorie() {
        let erwartet = [
            (("amenity", "hospital"), "krankenhaus"),
            (("amenity", "clinic"), "krankenhaus"),
            (("amenity", "nursing_home"), "pflege"),
            (("social_facility", "group_home"), "pflege"),
            (("amenity", "school"), "schule"),
            (("amenity", "kindergarten"), "schule"),
            (("man_made", "water_works"), "wasser"),
            (("man_made", "water_tower"), "wasser"),
            (("power", "substation"), "strom"),
            (("amenity", "fire_station"), "feuerwehr"),
            (("amenity", "police"), "polizei"),
        ];
        assert_eq!(erwartet.len(), KRITIS_TAGS.len());
        for ((k, v), kat) in erwartet {
            assert!(ist_kritis_tag(k, v), "{k}={v} muss als KRITIS-Tag gelten");
            assert_eq!(props(&[(k, v)]).unwrap()["kategorie"], kat, "{k}={v}");
        }
    }

    #[test]
    fn ohne_kritis_tag_kein_objekt() {
        assert!(props(&[("amenity", "cafe"), ("name", "Café")]).is_none());
        assert!(!ist_kritis_tag("amenity", "cafe"));
        assert!(!ist_kritis_tag("power", "tower"));
    }

    #[test]
    fn titel_faellt_auf_kategorie_zurueck() {
        assert_eq!(
            props(&[("power", "substation")]).unwrap()["titel"],
            "Umspannwerk"
        );
        assert_eq!(
            props(&[("amenity", "hospital"), ("name", "Uniklinik")]).unwrap()["titel"],
            "Uniklinik"
        );
    }

    #[test]
    fn reichert_adresse_und_kontakt_an() {
        let p = props(&[
            ("amenity", "hospital"),
            ("name", "Klinik"),
            ("addr:street", "Hauptstr."),
            ("addr:housenumber", "1"),
            ("addr:postcode", "50667"),
            ("addr:city", "Köln"),
            ("operator", "Stadt Köln"),
            ("contact:phone", "0221-1"),
            ("emergency", "yes"),
        ])
        .unwrap();
        assert_eq!(p["adresse"], "Hauptstr. 1, 50667 Köln");
        assert_eq!(p["betreiber"], "Stadt Köln");
        assert_eq!(p["telefon"], "0221-1");
        assert_eq!(p["notaufnahme"], "ja");
    }

    /// Ein Krankenhaus mit Pflegeangebot bleibt Krankenhaus (Vorrangfolge).
    #[test]
    fn vorrang_krankenhaus_vor_pflege() {
        let p = props(&[("amenity", "hospital"), ("social_facility", "nursing_home")]);
        assert_eq!(p.unwrap()["kategorie"], "krankenhaus");
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
                "uuid": "a6ee8177-107b-47dd-bcfd-30960ccc6e9c",
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
        // LFH-606: die uuid geht additiv mit — Auswahlliste und Karten-Schnellweg brauchen sie.
        assert_eq!(
            f["properties"]["uuid"],
            "a6ee8177-107b-47dd-bcfd-30960ccc6e9c"
        );
    }

    #[test]
    fn station_ohne_uuid_traegt_null() {
        let roh = json!([{ "longname": "X", "longitude": 7.0, "latitude": 51.0 }]);
        let fc = normalisiere_pegelonline(&roh);
        // Der Key steht da (mit null) — dieselbe Form wie die Nachbarn `km`/`gewaesser`.
        let props = fc["features"][0]["properties"].as_object().unwrap();
        assert!(props.contains_key("uuid"), "{props:?}");
        assert_eq!(props["uuid"], serde_json::Value::Null);
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
                "uuid": "a6ee8177-107b-47dd-bcfd-30960ccc6e9c",
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

// ------------------------------------------------------------ ENERGIE (LFH-81)
//
// Hybride Fachebene „Energieanlagen": OSM `power=plant` für die Standorte (auch die
// konventionellen Kraftwerke, die das Marktstammdatenregister ohne Koordinaten führt) und
// der bundesweite MaStR-Abzug der Einheiten über 10 MW. Beide Teile werden hier zu Punkten
// mit denselben flachen Properties normalisiert und bei der Anfrage zusammengeführt.
// Herleitung: `openspec/changes/lfh-81-fachebene-energie/design.md`.

use crate::karte::typen::Bbox;

/// Schwelle des Rauschfilters für nicht-konventionelle OSM-Anlagen: **mindestens** 10 MW.
/// Bewusst NICHT dieselbe Vergleichsart wie beim MaStR-Abruf (`~gt~10000`, also strikt
/// **über** 10 MW, beim Upstream gefiltert) — die Spec legt beide Grenzen getrennt fest, und
/// eine Anlage mit genau 10 MW aus OSM ist drin, eine MaStR-Einheit mit genau 10 000 kW nicht.
pub(crate) const ENERGIE_OSM_MIN_MW: f64 = 10.0;

/// Anlagenart aus dem MaStR-Feld `EnergietraegerName`. Unbekanntes → `sonstige`.
pub(crate) fn anlagenart_mastr(energietraeger: &str) -> &'static str {
    match energietraeger.trim().to_lowercase().as_str() {
        "braunkohle" | "steinkohle" => "kohle",
        "erdgas" | "andere gase" | "grubengas" => "gas",
        "mineralölprodukte" => "oel",
        "kernenergie" => "kern",
        "nicht biogener abfall" => "abfall",
        "wasser" => "wasser",
        "wind" => "wind",
        "solare strahlungsenergie" => "solar",
        "biomasse" => "biomasse",
        "speicher" => "speicher",
        _ => "sonstige",
    }
}

/// Anlagenart aus OSM `plant:source`. Mehrfachwerte (`biogas;solar`) zählen mit dem ERSTEN
/// Wert. `None` heißt „keine Quellenangabe" (für den Rauschfilter), ein unbekannter Wert
/// ergibt `sonstige`.
pub(crate) fn anlagenart_osm(plant_source: Option<&str>) -> Option<&'static str> {
    let erster = plant_source?.split(';').next()?.trim().to_lowercase();
    let art = match erster.as_str() {
        "" => return None,
        "coal" | "lignite" => "kohle",
        "gas" => "gas",
        // Bewusst Biomasse, nicht Gas: Biogasanlagen gibt es zu Tausenden im Kleinformat,
        // als „konventionell" gezählt kämen sie ohne Leistungsschwelle durch.
        "biogas" | "biomass" => "biomasse",
        "oil" => "oel",
        "nuclear" => "kern",
        "waste" => "abfall",
        "hydro" => "wasser",
        "wind" => "wind",
        "solar" => "solar",
        "battery" => "speicher",
        _ => "sonstige",
    };
    Some(art)
}

/// „Konventionell" im Sinne des Rauschfilters: erscheint unabhängig von der Leistung.
pub(crate) fn ist_konventionell(anlagenart: &str) -> bool {
    matches!(anlagenart, "kohle" | "gas" | "oel" | "kern" | "abfall")
}

/// Deutsches Label je Anlagenart — Titel einer OSM-Anlage ohne `name`.
fn anlagenart_label(anlagenart: &str) -> &'static str {
    match anlagenart {
        "kohle" => "Kohlekraftwerk",
        "gas" => "Gaskraftwerk",
        "oel" => "Ölkraftwerk",
        "kern" => "Kernkraftwerk",
        "abfall" => "Abfallkraftwerk",
        "wasser" => "Wasserkraftwerk",
        "wind" => "Windpark",
        "solar" => "Solarpark",
        "biomasse" => "Biomasseanlage",
        "speicher" => "Energiespeicher",
        _ => "Energieanlage",
    }
}

/// Rundet auf drei Nachkommastellen (1 kW) — Summen aus Kilowatt-Angaben tragen sonst
/// Gleitkomma-Rauschen wie `53.49999999`.
fn runde_mw(mw: f64) -> f64 {
    (mw * 1000.0).round() / 1000.0
}

/// Liest `plant:output:electricity` tolerant als MW. Nicht eindeutig Lesbares → `None`.
pub(crate) fn lies_leistung_mw(roh: &str) -> Option<f64> {
    let t = roh.trim();
    let zahl_ende = t
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(t.len());
    let (zahl, einheit) = t.split_at(zahl_ende);
    let faktor = match einheit.trim().to_lowercase().as_str() {
        "kw" => 0.001,
        "mw" => 1.0,
        "gw" => 1000.0,
        // Ohne Einheit ist eine Zahl nicht eindeutig; alles andere (`yes`, `~50`,
        // `12,1 MW`, `5 MW;3 MW`) auch nicht. Eine geschätzte Zahl erscheint nie als Messwert.
        _ => return None,
    };
    let wert: f64 = zahl.parse().ok()?;
    wert.is_finite().then(|| runde_mw(wert * faktor))
}

/// Overpass-JSON (`power=plant`) → FeatureCollection mit Rauschfilter.
///
/// Konventionelle Anlagen bleiben immer. Andere fallen weg, wenn ihre getaggte Leistung
/// unter [`ENERGIE_OSM_MIN_MW`] liegt; ohne auswertbare Leistung bleiben sie als
/// **Kandidat** stehen (`leistung_mw: null`) — trifft sie bei der Zusammenführung eine
/// MaStR-Einheit, trägt die die Leistung, sonst fällt sie dort heraus. Ohne Quellenangabe
/// UND ohne Leistung fällt eine Anlage gleich hier weg. Nur `power=plant` zählt; ein
/// Umspannwerk gehört zur KRITIS-Ebene, ein `generator` ist ein Einzelaggregat.
pub fn normalisiere_energie_osm(roh: &Value) -> Value {
    let elemente = roh
        .get("elements")
        .and_then(|e| e.as_array())
        .cloned()
        .unwrap_or_default();
    let features: Vec<Value> = elemente
        .iter()
        .filter_map(|el| {
            let tags = el.get("tags").and_then(|t| t.as_object());
            let g = |k: &str| tags.and_then(|t| t.get(k)).and_then(|v| v.as_str());
            if g("power") != Some("plant") {
                return None;
            }
            let (lon, lat) = if let (Some(lon), Some(lat)) = (
                el.get("lon").and_then(|v| v.as_f64()),
                el.get("lat").and_then(|v| v.as_f64()),
            ) {
                (lon, lat)
            } else {
                let c = el.get("center")?;
                (c.get("lon")?.as_f64()?, c.get("lat")?.as_f64()?)
            };
            let art = anlagenart_osm(g("plant:source"));
            let leistung = g("plant:output:electricity").and_then(lies_leistung_mw);
            let art = match (art, leistung) {
                (None, None) => return None,
                // Pumpspeicher führt MaStR unter „Speicher"; gleiche Art ist die Bedingung der
                // Zusammenführung, sonst stünde das Werk neben seinen eigenen Turbinen.
                (Some("wasser"), _) if g("plant:method") == Some("water-pumped-storage") => {
                    "speicher"
                }
                (Some(a), _) => a,
                (None, Some(_)) => "sonstige",
            };
            if !ist_konventionell(art) && leistung.is_some_and(|mw| mw < ENERGIE_OSM_MIN_MW) {
                return None;
            }
            let titel = g("name")
                .map(str::trim)
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| anlagenart_label(art));
            Some(energie_punkt(
                lon,
                lat,
                json!({
                    "titel": titel,
                    "anlagenart": art,
                    "leistung_mw": leistung,
                    "betreiber": g("operator"),
                    "betriebsstatus": Value::Null,
                    "herkunft": "osm",
                    "mastr_nummer": Value::Null,
                    "mastr_nummern": Value::Null,
                    "mastr_id": Value::Null,
                    "mastr_einheiten": Value::Null,
                }),
            ))
        })
        .collect();
    json!({ "type": "FeatureCollection", "features": features })
}

fn energie_punkt(lon: f64, lat: f64, properties: Value) -> Value {
    json!({
        "type": "Feature",
        "geometry": { "type": "Point", "coordinates": [lon, lat] },
        "properties": properties
    })
}

/// `(lon, lat)` eines Punkt-Features.
fn punkt_koordinate(f: &Value) -> Option<(f64, f64)> {
    let c = f.get("geometry")?.get("coordinates")?.as_array()?;
    Some((c.first()?.as_f64()?, c.get(1)?.as_f64()?))
}

/// MaStR-Antwort (`{"Total":n,"Data":[…]}`) → Punkte.
///
/// Fehlt die `Data`-Liste oder ist sie keine Liste, ist das ein `Err` und **keine** leere
/// Collection: die Filterfelder des Endpunkts sind Anzeigenamen des Portals und können sich
/// still ändern, und ein Leerstand sähe aus wie „keine Großanlagen in Deutschland".
/// Einheiten ohne Koordinate werden übersprungen (der Upstream-Filter sortiert sie schon aus).
pub fn normalisiere_energie_mastr(roh: &Value) -> Result<Vec<Value>, String> {
    let daten = roh
        .get("Data")
        .and_then(|d| d.as_array())
        .ok_or_else(|| "MaStR-Antwort ohne Data-Liste".to_string())?;
    let text = |e: &Value, k: &str| {
        e.get(k)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    Ok(daten
        .iter()
        .filter_map(|e| {
            let lat = e.get("Breitengrad")?.as_f64()?;
            let lon = e.get("Laengengrad")?.as_f64()?;
            let art = anlagenart_mastr(e.get("EnergietraegerName")?.as_str().unwrap_or(""));
            let titel = [
                "KraftwerkName",
                "SolarparkName",
                "WindparkName",
                "EinheitName",
            ]
            .iter()
            .find_map(|k| text(e, k))
            .unwrap_or_else(|| anlagenart_label(art).to_string());
            let leistung = e
                .get("Nettonennleistung")
                .and_then(|v| v.as_f64())
                .map(|kw| runde_mw(kw / 1000.0));
            Some(energie_punkt(
                lon,
                lat,
                json!({
                    "titel": titel,
                    "anlagenart": art,
                    "leistung_mw": leistung,
                    "betreiber": text(e, "AnlagenbetreiberName"),
                    "betriebsstatus": text(e, "BetriebsStatusName"),
                    "herkunft": "mastr",
                    "mastr_nummer": text(e, "MaStRNummer"),
                    "mastr_nummern": text(e, "MaStRNummer"),
                    "mastr_id": e.get("Id").and_then(|v| v.as_i64()),
                    "mastr_einheiten": 1,
                }),
            ))
        })
        .collect())
}

/// Rand der OSM-Abfrage in Vielfachen des Zuordnungsradius (siehe [`fuehre_energie_zusammen`]).
/// `quellen::erneuere_energie_osm` fragt Overpass auf die um diesen Rand erweiterte bbox.
pub const ENERGIE_OSM_RAND_RADIEN: f64 = 3.0;
/// Rand der MaStR-Einheiten, die in die Zuordnung eingehen, in Vielfachen des Radius.
const ENERGIE_MASTR_RAND_RADIEN: f64 = 2.0;

/// Führt die OSM- und MaStR-Punkte für einen Ausschnitt zusammen.
///
/// Jede MaStR-Einheit geht an die **nächste** OSM-Anlage **gleicher** Anlagenart im Umkreis
/// von `radius_m`; mehrere Einheiten an einer Anlage summieren ihre Leistung, geführt werden
/// Nummer, Id, Betreiber und Status der größten, `mastr_nummern` nennt alle. Der Punkt
/// bleibt am OSM-Standort (die OSM-Mitte trifft die Anlage besser als der Einheitenpunkt),
/// die Herkunft wird `osm+mastr`. Übrige MaStR-Einheiten erscheinen als eigene Punkte. Eine
/// nicht-konventionelle OSM-Anlage ohne Leistung (Kandidat aus
/// [`normalisiere_energie_osm`]) erscheint nur mit Treffer.
///
/// **Der Abgleich läuft über einen erweiterten Rand, nicht über den Ausschnitt** (Review-
/// Befund zu LFH-81). Beschnitte man beide Seiten vorher auf die bbox, entstünde an der
/// Kante eine Doppelung: die Einheit liegt drin, ihre OSM-Anlage 1 km weiter draußen → im
/// einen Ausschnitt ein eigener `mastr`-Punkt, im Nachbarausschnitt ein `osm+mastr`-Punkt,
/// und das Frontend sammelt beim Verschieben beide auf. Der Rand ist so gewählt, dass die
/// Antwort für jeden ausgegebenen Punkt dieselbe ist wie in jedem anderen Ausschnitt:
///
/// - ausgegeben wird eine OSM-Anlage, wenn sie selbst im Ausschnitt liegt ODER eine ihr
///   zugeordnete Einheit — sie liegt also höchstens `r` vor der Kante;
/// - deren Einheiten liegen höchstens `r` von ihr, also höchstens `2 r` vor der Kante;
/// - wohin eine solche Einheit gehört, entscheidet die nächste Anlage in `r` um sie, also
///   bis `3 r` vor der Kante.
///
/// Deshalb gehen Einheiten aus `2 r` und OSM-Anlagen aus `3 r` in den Abgleich
/// ([`ENERGIE_OSM_RAND_RADIEN`] trägt die Overpass-Abfrage mit). Ein Rand von nur `r`
/// verschöbe die Abweichung eine Stufe nach außen: dann zählte dieselbe Anlage in zwei
/// Nachbarausschnitten verschieden viele Einheiten. Ein reiner `mastr`-Punkt erscheint,
/// wenn die Einheit im Ausschnitt liegt. Der Punkt einer zusammengeführten Anlage kann
/// damit bis `r` außerhalb der bbox stehen — das ist gewollt, er ist derselbe wie nebenan.
pub fn fuehre_energie_zusammen(
    osm: &[Value],
    mastr: &[Value],
    bbox: &Bbox,
    radius_m: f64,
) -> Vec<Value> {
    use crate::geocoding::peilung::haversine_m;
    let in_bbox = |b: Bbox| {
        move |f: &&Value| punkt_koordinate(f).is_some_and(|(lon, lat)| b.enthaelt(lon, lat))
    };
    let im_ausschnitt = in_bbox(*bbox);
    let art = |f: &Value| {
        f["properties"]["anlagenart"]
            .as_str()
            .unwrap_or("")
            .to_string()
    };
    let mw = |f: &Value| f["properties"]["leistung_mw"].as_f64();
    let nummer = |f: &Value| f["properties"]["mastr_nummer"].as_str().map(str::to_string);

    let osm: Vec<&Value> = osm
        .iter()
        .filter(in_bbox(
            bbox.erweitert_um_m(ENERGIE_OSM_RAND_RADIEN * radius_m),
        ))
        .collect();
    let mut zugeordnet: Vec<Vec<&Value>> = vec![Vec::new(); osm.len()];
    let mut ergebnis: Vec<Value> = Vec::new();

    for m in mastr.iter().filter(in_bbox(
        bbox.erweitert_um_m(ENERGIE_MASTR_RAND_RADIEN * radius_m),
    )) {
        let Some((mlon, mlat)) = punkt_koordinate(m) else {
            continue;
        };
        let m_art = art(m);
        let naechste = osm
            .iter()
            .enumerate()
            .filter(|(_, o)| art(o) == m_art)
            .filter_map(|(i, o)| {
                let (olon, olat) = punkt_koordinate(o)?;
                let d = haversine_m((mlat, mlon), (olat, olon));
                (d <= radius_m).then_some((i, d))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1));
        match naechste {
            Some((i, _)) => zugeordnet[i].push(m),
            None if im_ausschnitt(&m) => {
                let mut f = m.clone();
                // Aus dem Einzelwert gebildet statt aus dem Normalisierer gelesen: ein
                // Cache-Stand von vor dem Feld trägt es nicht.
                f["properties"]["mastr_nummern"] = json!(nummer(m));
                ergebnis.push(f);
            }
            None => {}
        }
    }

    let mut osm_punkte: Vec<Value> = Vec::new();
    for (o, einheiten) in osm.into_iter().zip(zugeordnet) {
        if einheiten.is_empty() {
            if im_ausschnitt(&o) && (ist_konventionell(&art(o)) || mw(o).is_some()) {
                let mut f = o.clone();
                f["properties"]["mastr_nummern"] = Value::Null;
                osm_punkte.push(f);
            }
            continue;
        }
        if !im_ausschnitt(&o) && !einheiten.iter().any(im_ausschnitt) {
            continue;
        }
        let groesste = einheiten
            .iter()
            .max_by(|a, b| mw(a).unwrap_or(0.0).total_cmp(&mw(b).unwrap_or(0.0)))
            .expect("nicht leer");
        let summe: Option<f64> = einheiten
            .iter()
            .filter_map(|e| mw(e))
            .fold(None, |acc, x| Some(acc.unwrap_or(0.0) + x));
        // Lexikographisch über die Zeichenketten (`SEE…`), nicht numerisch — die Reihenfolge
        // ist damit unabhängig von der Reihenfolge des Abzugs und in jedem Ausschnitt gleich.
        let mut nummern: Vec<String> = einheiten.iter().filter_map(|e| nummer(e)).collect();
        nummern.sort();
        let gp = &groesste["properties"];
        let mut f = o.clone();
        let p = &mut f["properties"];
        p["leistung_mw"] = json!(summe.map(runde_mw).or_else(|| mw(o)));
        if !gp["betreiber"].is_null() {
            p["betreiber"] = gp["betreiber"].clone();
        }
        p["betriebsstatus"] = gp["betriebsstatus"].clone();
        p["herkunft"] = json!("osm+mastr");
        p["mastr_nummer"] = gp["mastr_nummer"].clone();
        p["mastr_nummern"] = if nummern.is_empty() {
            Value::Null
        } else {
            json!(nummern.join(","))
        };
        p["mastr_id"] = gp["mastr_id"].clone();
        p["mastr_einheiten"] = json!(einheiten.len());
        osm_punkte.push(f);
    }
    osm_punkte.extend(ergebnis);
    osm_punkte
}

/// Quellennennung aus den tatsächlich beitragenden Teilen.
///
/// Genannt wird nur, was zu den ausgelieferten Punkten beiträgt (Spec „Korrekte
/// Quellennennung": MUST NOT eine Quelle nennen, die nichts beiträgt). Ohne Beitrag bleibt
/// die Zeile leer — dann ist auch nichts eingezeichnet.
pub fn energie_attribution(osm_traegt_bei: bool, mastr_traegt_bei: bool) -> String {
    let mut teile = Vec::new();
    if osm_traegt_bei {
        teile.push(ENERGIE_OSM_ATTRIB);
    }
    if mastr_traegt_bei {
        teile.push(ENERGIE_MASTR_ATTRIB);
    }
    teile.join(" · ")
}

/// OSM-Nennung (ODbL), wortgleich mit der KRITIS-Ebene.
pub const ENERGIE_OSM_ATTRIB: &str = "© OpenStreetMap-Beitragende (ODbL)";
/// MaStR-Nennung nach §2 dl-de/by-2-0, Bereitsteller laut Impressum des Portals. Den Link
/// auf die Lizenz und den Datensatz tragen `docs/fachebenen-quellen.md` und der Inspector —
/// die Attributionszeile der Karte ist Klartext.
pub const ENERGIE_MASTR_ATTRIB: &str = "Marktstammdatenregister, Bundesnetzagentur – dl-de/by-2-0";

/// Trägt eine Herkunft zum OSM- bzw. MaStR-Teil bei? Liefert `(osm, mastr)`.
pub fn energie_beitraege(features: &[Value]) -> (bool, bool) {
    features.iter().fold((false, false), |(o, m), f| {
        let h = f["properties"]["herkunft"].as_str().unwrap_or("");
        (o || h.starts_with("osm"), m || h.ends_with("mastr"))
    })
}

#[cfg(test)]
mod energie_tests {
    use super::*;

    const OVERPASS_RUHR: &str = include_str!("testdaten/energie-overpass-ruhr.json");
    const MASTR_AUSZUG: &str = include_str!("testdaten/energie-mastr-auszug.json");

    fn anlage(source: Option<&str>, leistung: Option<&str>) -> Value {
        let mut tags = serde_json::Map::new();
        tags.insert("power".into(), json!("plant"));
        tags.insert("name".into(), json!("Testanlage"));
        if let Some(s) = source {
            tags.insert("plant:source".into(), json!(s));
        }
        if let Some(l) = leistung {
            tags.insert("plant:output:electricity".into(), json!(l));
        }
        json!({ "elements": [ { "type": "way", "id": 1,
            "center": { "lat": 51.5, "lon": 7.0 }, "tags": tags } ] })
    }

    fn features(fc: &Value) -> Vec<Value> {
        fc["features"].as_array().cloned().unwrap_or_default()
    }

    fn titel(fs: &[Value]) -> Vec<String> {
        fs.iter()
            .map(|f| f["properties"]["titel"].as_str().unwrap_or("").to_string())
            .collect()
    }

    /// Ein Punkt mit den flachen Energie-Properties, wie ihn die beiden Normalisierer bauen.
    fn punkt(lon: f64, lat: f64, art: &str, mw: Option<f64>, herkunft: &str) -> Value {
        let mastr = herkunft == "mastr";
        json!({ "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [lon, lat] },
            "properties": {
                "titel": format!("{herkunft}-{art}-{lon}"),
                "anlagenart": art,
                "leistung_mw": mw,
                "betreiber": if mastr { json!("MaStR-Betreiber") } else { json!("OSM-Betreiber") },
                "betriebsstatus": if mastr { json!("In Betrieb") } else { Value::Null },
                "herkunft": herkunft,
                "mastr_nummer": if mastr { json!(format!("SEE{lon}")) } else { Value::Null },
                "mastr_id": if mastr { json!((lon * 1000.0) as i64) } else { Value::Null },
                "mastr_einheiten": if mastr { json!(1) } else { Value::Null },
            } })
    }

    // ---- 1.2 Anlagenart

    #[test]
    fn anlagenart_aus_mastr_energietraeger() {
        for (roh, art) in [
            ("Braunkohle", "kohle"),
            ("Steinkohle", "kohle"),
            ("Erdgas", "gas"),
            ("andere Gase", "gas"),
            ("Grubengas", "gas"),
            ("Mineralölprodukte", "oel"),
            ("Kernenergie", "kern"),
            ("nicht biogener Abfall", "abfall"),
            ("Nicht biogener Abfall", "abfall"),
            ("Wasser", "wasser"),
            ("Wind", "wind"),
            ("Solare Strahlungsenergie", "solar"),
            ("Biomasse", "biomasse"),
            ("Speicher", "speicher"),
            ("Wärme", "sonstige"),
            ("Geothermie", "sonstige"),
            ("völlig unbekannt", "sonstige"),
        ] {
            assert_eq!(anlagenart_mastr(roh), art, "Energieträger {roh:?}");
        }
    }

    #[test]
    fn anlagenart_aus_osm_plant_source() {
        for (roh, art) in [
            ("coal", "kohle"),
            ("lignite", "kohle"),
            ("gas", "gas"),
            ("biogas", "biomasse"),
            ("oil", "oel"),
            ("nuclear", "kern"),
            ("waste", "abfall"),
            ("hydro", "wasser"),
            ("wind", "wind"),
            ("solar", "solar"),
            ("biomass", "biomasse"),
            ("battery", "speicher"),
            // Mehrfachwert: der ERSTE zählt, und Biogas ist Biomasse, nicht Gas.
            ("biogas;solar", "biomasse"),
            ("gas; oil", "gas"),
            ("geothermal", "sonstige"),
        ] {
            assert_eq!(anlagenart_osm(Some(roh)), Some(art), "plant:source {roh:?}");
        }
        assert_eq!(anlagenart_osm(None), None);
        assert_eq!(anlagenart_osm(Some("")), None);
    }

    #[test]
    fn konventionell_sind_genau_fuenf_arten() {
        for art in ["kohle", "gas", "oel", "kern", "abfall"] {
            assert!(ist_konventionell(art), "{art}");
        }
        for art in [
            "wasser", "wind", "solar", "biomasse", "speicher", "sonstige",
        ] {
            assert!(!ist_konventionell(art), "{art}");
        }
    }

    // ---- 1.3 Leistungsleser

    #[test]
    fn leistung_wird_tolerant_gelesen() {
        for (roh, mw) in [
            ("690 MW", Some(690.0)),
            ("690MW", Some(690.0)),
            ("1.2 GW", Some(1200.0)),
            ("12000 kW", Some(12.0)),
            ("12.1 MW", Some(12.1)),
            ("5.420 MW", Some(5.42)),
            (" 15 mw ", Some(15.0)),
            ("yes", None),
            ("", None),
            ("~50", None),
            ("50", None),      // ohne Einheit nicht eindeutig
            ("12,1 MW", None), // Komma: Dezimal- oder Tausendertrenner?
            ("-5 MW", None),
            ("5 MW;3 MW", None),
        ] {
            let ist = lies_leistung_mw(roh);
            match (ist, mw) {
                (Some(a), Some(b)) => assert!((a - b).abs() < 1e-9, "{roh:?}: {a} ≠ {b}"),
                (a, b) => assert_eq!(a, b, "{roh:?}"),
            }
        }
    }

    // ---- 1.4 OSM-Normalisierer mit Rauschfilter

    #[test]
    fn kleine_solaranlage_erscheint_nicht() {
        let fc = normalisiere_energie_osm(&anlage(Some("solar"), Some("2 MW")));
        assert!(features(&fc).is_empty());
    }

    #[test]
    fn gaskraftwerk_ohne_leistung_erscheint_mit_leistung_unbekannt() {
        let fc = normalisiere_energie_osm(&anlage(Some("gas"), None));
        let fs = features(&fc);
        assert_eq!(fs.len(), 1);
        let p = &fs[0]["properties"];
        assert_eq!(p["anlagenart"], "gas");
        assert_eq!(p["leistung_mw"], Value::Null);
        assert_eq!(p["herkunft"], "osm");
    }

    #[test]
    fn anlage_ohne_quelle_und_ohne_leistung_faellt_weg() {
        assert!(features(&normalisiere_energie_osm(&anlage(None, None))).is_empty());
        // Nicht auswertbare Leistung zählt wie keine.
        assert!(features(&normalisiere_energie_osm(&anlage(None, Some("yes")))).is_empty());
        // Ohne Quelle, aber mit großer Leistung: bleibt, als `sonstige`.
        let fs = features(&normalisiere_energie_osm(&anlage(None, Some("40 MW"))));
        assert_eq!(fs.len(), 1);
        assert_eq!(fs[0]["properties"]["anlagenart"], "sonstige");
    }

    #[test]
    fn nicht_auswertbare_leistung_wird_unbekannt_statt_erfunden() {
        let fs = features(&normalisiere_energie_osm(&anlage(Some("gas"), Some("yes"))));
        assert_eq!(fs.len(), 1);
        assert_eq!(fs[0]["properties"]["leistung_mw"], Value::Null);
    }

    #[test]
    fn leistung_als_text_wird_zahl() {
        let fs = features(&normalisiere_energie_osm(&anlage(
            Some("coal"),
            Some("690 MW"),
        )));
        assert_eq!(fs[0]["properties"]["leistung_mw"], json!(690.0));
    }

    /// Die OSM-Grenze ist „mindestens 10 MW" (≥), anders als MaStR (> 10 MW, beim
    /// Upstream). Eine spätere Vereinheitlichung auf eine Vergleichsart färbt das rot.
    #[test]
    fn osm_grenze_ist_mindestens_zehn_mw() {
        assert_eq!(
            features(&normalisiere_energie_osm(&anlage(
                Some("solar"),
                Some("10 MW")
            )))
            .len(),
            1
        );
        assert!(features(&normalisiere_energie_osm(&anlage(
            Some("solar"),
            Some("9.99 MW")
        )))
        .is_empty());
    }

    /// Erneuerbare ohne Leistung bleiben im OSM-Teil als KANDIDAT stehen: trifft sie eine
    /// MaStR-Einheit, trägt die die Leistung (design.md, Risiken). Ohne Treffer fällt sie
    /// erst bei der Zusammenführung heraus (siehe `fuehre_*`-Tests).
    #[test]
    fn erneuerbare_ohne_leistung_bleibt_kandidat() {
        let fs = features(&normalisiere_energie_osm(&anlage(
            Some("hydro"),
            Some("yes"),
        )));
        assert_eq!(fs.len(), 1);
        assert_eq!(fs[0]["properties"]["leistung_mw"], Value::Null);
    }

    /// MaStR führt Pumpspeicher unter „Speicher", OSM als `plant:source=hydro` mit
    /// `plant:method=water-pumped-storage`. Ohne Angleichung stünde ein Pumpspeicherwerk
    /// neben seinen eigenen Turbinen (live gemessen am PSW Happurg: fünf Punkte statt einem).
    #[test]
    fn pumpspeicher_ist_speicher_wie_im_mastr() {
        let roh = json!({ "elements": [ { "type": "way", "id": 1,
            "center": { "lat": 49.49, "lon": 11.47 },
            "tags": { "power": "plant", "name": "Pumpspeicherwerk", "plant:source": "hydro",
                "plant:method": "water-pumped-storage", "plant:output:electricity": "160 MW" } } ] });
        let fs = features(&normalisiere_energie_osm(&roh));
        assert_eq!(fs[0]["properties"]["anlagenart"], "speicher");
        // Laufwasser bleibt Wasser.
        let fs = features(&normalisiere_energie_osm(&anlage(
            Some("hydro"),
            Some("20 MW"),
        )));
        assert_eq!(fs[0]["properties"]["anlagenart"], "wasser");
    }

    #[test]
    fn umspannwerk_und_generator_gehoeren_nicht_dazu() {
        let roh = json!({ "elements": [
            { "type": "node", "id": 1, "lat": 51.5, "lon": 7.0,
              "tags": { "power": "substation", "name": "UW", "plant:source": "gas" } },
            { "type": "node", "id": 2, "lat": 51.5, "lon": 7.0,
              "tags": { "power": "generator", "generator:source": "gas", "plant:source": "gas" } }
        ] });
        assert!(features(&normalisiere_energie_osm(&roh)).is_empty());
    }

    #[test]
    fn osm_punkt_traegt_alle_schluessel_flach() {
        let fs = features(&normalisiere_energie_osm(&anlage(
            Some("gas"),
            Some("608 MW"),
        )));
        let p = fs[0]["properties"].as_object().unwrap();
        for k in [
            "titel",
            "anlagenart",
            "leistung_mw",
            "betreiber",
            "betriebsstatus",
            "herkunft",
            "mastr_nummer",
            "mastr_nummern",
            "mastr_id",
            "mastr_einheiten",
        ] {
            assert!(p.contains_key(k), "Schlüssel {k} fehlt");
        }
        assert_eq!(p["betriebsstatus"], Value::Null);
        assert_eq!(p["mastr_einheiten"], Value::Null);
        assert_eq!(fs[0]["geometry"]["coordinates"], json!([7.0, 51.5]));
    }

    #[test]
    fn osm_titel_faellt_auf_die_anlagenart_zurueck() {
        let roh = json!({ "elements": [ { "type": "node", "id": 1, "lat": 51.5, "lon": 7.0,
            "tags": { "power": "plant", "plant:source": "gas", "operator": "Stadtwerke" } } ] });
        let fs = features(&normalisiere_energie_osm(&roh));
        assert_eq!(fs[0]["properties"]["titel"], "Gaskraftwerk");
        assert_eq!(fs[0]["properties"]["betreiber"], "Stadtwerke");
    }

    /// LFH-265: siehe `nina_output_passt_auf_den_geojson_anker`.
    #[test]
    fn energie_osm_output_passt_auf_den_geojson_anker() {
        let roh: Value = serde_json::from_str(OVERPASS_RUHR).unwrap();
        serde_json::from_value::<crate::karte::typen::GeoJsonFeatureCollection>(
            normalisiere_energie_osm(&roh),
        )
        .expect("Anker beschreibt die reale Energie-Form");
    }

    /// Echter Overpass-Abzug (Ruhrgebiet, 21.09.2026, 30 Objekte, auf die gelesenen Tags
    /// gekürzt), durch Normalisierer UND Zusammenführung ohne MaStR-Teil: die zwei großen
    /// Kraftwerke stehen drin, keine PV-Kleinanlage und keine Biogasanlage ohne Leistung.
    #[test]
    fn echter_ruhr_abzug_zeigt_grosskraftwerke_und_keine_kleinanlagen() {
        let roh: Value = serde_json::from_str(OVERPASS_RUHR).unwrap();
        let osm = features(&normalisiere_energie_osm(&roh));
        let bbox = Bbox::parse("6.8,51.35,7.4,51.65").unwrap();
        let fs = fuehre_energie_zusammen(&osm, &[], &bbox, 2000.0);
        let t = titel(&fs);
        for soll in [
            "Kraftwerk Scholven",
            "GuD Herne",
            "Heizkraftwerk Herne",
            "GBS KW Herne",
        ] {
            assert!(t.iter().any(|x| x == soll), "{soll} fehlt in {t:?}");
        }
        for nicht in [
            "Harpener Watt",                 // Solar ohne Leistung, kein MaStR-Treffer
            "Biogasanlage Bebbelsdorf",      // biogas;solar → Biomasse, ohne Leistung
            "storage44",                     // Speicher 0,36 MW
            "Wasserkraftwerk Baldeney",      // Wasser 9,2 MW
            "Wasserkraftwerk Horster Mühle", // Wasser „yes"
        ] {
            assert!(
                !t.iter().any(|x| x == nicht),
                "{nicht} dürfte nicht erscheinen"
            );
        }
        // Keine Solaranlage überhaupt — die drei im Abzug haben keine auswertbare Leistung.
        assert!(fs.iter().all(|f| f["properties"]["anlagenart"] != "solar"));
        let scholven = fs
            .iter()
            .find(|f| f["properties"]["titel"] == "Kraftwerk Scholven")
            .unwrap();
        assert_eq!(scholven["properties"]["anlagenart"], "kohle");
        assert_eq!(scholven["properties"]["leistung_mw"], json!(690.0));
        assert_eq!(scholven["properties"]["betreiber"], "Uniper Kraftwerke");
    }

    // ---- 1.5 MaStR-Normalisierer

    #[test]
    fn mastr_auszug_wird_zu_punkten() {
        let roh: Value = serde_json::from_str(MASTR_AUSZUG).unwrap();
        let fs = normalisiere_energie_mastr(&roh).unwrap();
        assert_eq!(fs.len(), 5);
        let wkw = fs
            .iter()
            .find(|f| f["properties"]["titel"] == "WKW III")
            .unwrap();
        let p = &wkw["properties"];
        assert_eq!(p["anlagenart"], "wasser");
        assert_eq!(p["leistung_mw"], json!(18.5));
        assert_eq!(p["betreiber"], "Alzkraftwerke Heider GmbH");
        assert_eq!(p["betriebsstatus"], "In Betrieb");
        assert_eq!(p["herkunft"], "mastr");
        assert_eq!(p["mastr_nummer"], "SEE980008908440");
        assert_eq!(p["mastr_id"], json!(1815635));
        assert_eq!(p["mastr_einheiten"], json!(1));
        assert_eq!(wkw["geometry"]["coordinates"], json!([12.652, 48.154]));
        // Titelkette: KraftwerkName (im Bestand nie gesetzt) → SolarparkName → WindparkName
        // → EinheitName.
        let t = titel(&fs);
        assert!(t.contains(&"SA Giebelstadt II".to_string()), "{t:?}");
        assert!(t.contains(&"EnBW He Dreiht".to_string()), "{t:?}");
        assert!(fs
            .iter()
            .any(|f| f["properties"]["betriebsstatus"] == "Vorübergehend stillgelegt"));
    }

    #[test]
    fn mastr_titel_nimmt_den_ersten_nicht_leeren_namen() {
        let roh = json!({ "Total": 1, "Data": [ {
            "Id": 7, "MaStRNummer": "SEE1", "KraftwerkName": "  ", "SolarparkName": "",
            "WindparkName": null, "EinheitName": "Einheit 7", "Breitengrad": 51.0,
            "Laengengrad": 7.0, "Nettonennleistung": 12000.0, "EnergietraegerName": "Wind",
            "BetriebsStatusName": "In Betrieb", "AnlagenbetreiberName": null } ] });
        let fs = normalisiere_energie_mastr(&roh).unwrap();
        assert_eq!(fs[0]["properties"]["titel"], "Einheit 7");
        assert_eq!(fs[0]["properties"]["betreiber"], Value::Null);
    }

    #[test]
    fn mastr_einheit_ohne_koordinate_wird_uebersprungen() {
        let roh = json!({ "Total": 1, "Data": [ { "Id": 7, "EinheitName": "X",
            "Breitengrad": null, "Laengengrad": 7.0, "Nettonennleistung": 12000.0,
            "EnergietraegerName": "Wind" } ] });
        assert!(normalisiere_energie_mastr(&roh).unwrap().is_empty());
    }

    /// Eine Antwort ohne `Data`-Liste ist ein FEHLSCHLAG, kein Leerstand — ein Leerstand
    /// sähe aus wie „keine Großanlagen in Deutschland", und niemand würde misstrauisch.
    #[test]
    fn mastr_formfehler_ist_err_und_keine_leere_collection() {
        assert!(normalisiere_energie_mastr(&json!({ "Total": 0 })).is_err());
        assert!(normalisiere_energie_mastr(&json!({ "Data": "kaputt" })).is_err());
        assert!(normalisiere_energie_mastr(&json!([1, 2])).is_err());
        assert!(normalisiere_energie_mastr(&json!({ "Errors": ["WAF"] })).is_err());
    }

    #[test]
    fn energie_mastr_output_passt_auf_den_geojson_anker() {
        let roh: Value = serde_json::from_str(MASTR_AUSZUG).unwrap();
        let fs = normalisiere_energie_mastr(&roh).unwrap();
        serde_json::from_value::<crate::karte::typen::GeoJsonFeatureCollection>(
            json!({ "type": "FeatureCollection", "features": fs }),
        )
        .expect("Anker beschreibt die reale MaStR-Form");
    }

    // ---- 1.6 Zusammenführung und bbox

    fn bbox() -> Bbox {
        Bbox::parse("6.5,51.0,7.5,52.0").unwrap()
    }

    #[test]
    fn wasserkraftwerk_in_beiden_quellen_wird_ein_punkt() {
        let osm = vec![punkt(7.0, 51.5, "wasser", None, "osm")];
        // ~500 m östlich (bei 51,5° N sind 0,0072° Länge rund 500 m).
        let mastr = vec![punkt(7.0072, 51.5, "wasser", Some(18.5), "mastr")];
        let fs = fuehre_energie_zusammen(&osm, &mastr, &bbox(), 2000.0);
        assert_eq!(fs.len(), 1);
        let f = &fs[0];
        let p = &f["properties"];
        assert_eq!(p["herkunft"], "osm+mastr");
        assert_eq!(p["leistung_mw"], json!(18.5));
        assert_eq!(p["betreiber"], "MaStR-Betreiber");
        assert_eq!(p["betriebsstatus"], "In Betrieb");
        assert_eq!(p["mastr_nummer"], "SEE7.0072");
        assert_eq!(p["mastr_einheiten"], json!(1));
        // Punkt und Titel bleiben am OSM-Standort bzw. beim OSM-Namen.
        assert_eq!(f["geometry"]["coordinates"], json!([7.0, 51.5]));
        assert_eq!(p["titel"], "osm-wasser-7");
    }

    #[test]
    fn unterschiedliche_anlagenart_ergibt_zwei_punkte() {
        let osm = vec![punkt(7.0, 51.5, "gas", None, "osm")];
        let mastr = vec![punkt(7.001, 51.5, "speicher", Some(15.0), "mastr")];
        let fs = fuehre_energie_zusammen(&osm, &mastr, &bbox(), 2000.0);
        assert_eq!(fs.len(), 2);
        let herkunft: Vec<_> = fs
            .iter()
            .map(|f| f["properties"]["herkunft"].clone())
            .collect();
        assert!(herkunft.contains(&json!("osm")) && herkunft.contains(&json!("mastr")));
    }

    #[test]
    fn mehrere_einheiten_an_einer_anlage_summieren() {
        let osm = vec![punkt(7.0, 51.5, "speicher", Some(20.0), "osm")];
        let mastr = vec![
            punkt(7.001, 51.5, "speicher", Some(12.5), "mastr"),
            punkt(7.002, 51.5, "speicher", Some(30.0), "mastr"),
            punkt(7.003, 51.5, "speicher", Some(11.0), "mastr"),
        ];
        let fs = fuehre_energie_zusammen(&osm, &mastr, &bbox(), 2000.0);
        assert_eq!(fs.len(), 1);
        let p = &fs[0]["properties"];
        assert_eq!(p["leistung_mw"], json!(53.5));
        assert_eq!(p["mastr_einheiten"], json!(3));
        // Nummer und Id der GRÖSSTEN Einheit.
        assert_eq!(p["mastr_nummer"], "SEE7.002");
        assert_eq!(p["mastr_id"], json!(7002));
    }

    #[test]
    fn einheit_geht_an_die_naechste_gleichartige_anlage() {
        let osm = vec![
            punkt(7.0, 51.5, "wasser", Some(12.0), "osm"),
            punkt(7.02, 51.5, "wasser", Some(12.0), "osm"),
        ];
        let mastr = vec![punkt(7.015, 51.5, "wasser", Some(18.0), "mastr")];
        let fs = fuehre_energie_zusammen(&osm, &mastr, &bbox(), 2000.0);
        assert_eq!(fs.len(), 2);
        let gemischt = fs
            .iter()
            .find(|f| f["properties"]["herkunft"] == "osm+mastr")
            .unwrap();
        assert_eq!(gemischt["geometry"]["coordinates"], json!([7.02, 51.5]));
    }

    #[test]
    fn ausserhalb_des_radius_bleiben_zwei_punkte() {
        let osm = vec![punkt(7.0, 51.5, "wasser", Some(12.0), "osm")];
        // ~3,5 km östlich
        let mastr = vec![punkt(7.05, 51.5, "wasser", Some(18.0), "mastr")];
        assert_eq!(
            fuehre_energie_zusammen(&osm, &mastr, &bbox(), 2000.0).len(),
            2
        );
    }

    #[test]
    fn erneuerbare_osm_ohne_leistung_nur_mit_mastr_treffer() {
        let osm = vec![
            punkt(7.0, 51.5, "solar", None, "osm"),
            punkt(7.3, 51.5, "solar", None, "osm"),
        ];
        let mastr = vec![punkt(7.001, 51.5, "solar", Some(14.0), "mastr")];
        let fs = fuehre_energie_zusammen(&osm, &mastr, &bbox(), 2000.0);
        assert_eq!(fs.len(), 1, "der Kandidat ohne Treffer fällt weg");
        assert_eq!(fs[0]["properties"]["herkunft"], "osm+mastr");
        assert_eq!(fs[0]["properties"]["leistung_mw"], json!(14.0));
    }

    #[test]
    fn nur_anlagen_im_ausschnitt() {
        // Je Quelle ein Punkt drin, einer draußen: der OSM-Teil ist auf einen Rand um die
        // bbox abgefragt und ragt über sie hinaus. Eine Anlage dort ohne zugeordnete Einheit
        // im Ausschnitt erscheint nicht.
        let osm = vec![
            punkt(7.0, 51.5, "gas", None, "osm"),
            punkt(7.504, 51.5, "gas", None, "osm"),
        ];
        let mastr = vec![
            punkt(6.8, 51.2, "wind", Some(15.0), "mastr"),
            punkt(12.0, 48.0, "wind", Some(15.0), "mastr"),
        ];
        let fs = fuehre_energie_zusammen(&osm, &mastr, &bbox(), 2000.0);
        let koord: Vec<_> = fs
            .iter()
            .map(|f| f["geometry"]["coordinates"].clone())
            .collect();
        assert_eq!(fs.len(), 2, "{koord:?}");
        assert!(koord.contains(&json!([7.0, 51.5])));
        assert!(koord.contains(&json!([6.8, 51.2])));
    }

    // ---- Rand des Ausschnitts (Review-Befund 2)

    /// Zwei Nachbarausschnitte mit gemeinsamer Kante bei 7,0° O, 51,25° N.
    fn nachbarn() -> (Bbox, Bbox) {
        (
            Bbox::parse("6.5,51.0,7.0,51.5").unwrap(),
            Bbox::parse("7.0,51.0,7.5,51.5").unwrap(),
        )
    }

    /// Die MaStR-Einheit liegt im linken Ausschnitt, ihre OSM-Anlage (~1 km entfernt) im
    /// rechten. Vorher entstand links ein eigener `mastr`-Punkt, rechts ein `osm`-Punkt —
    /// nach dem Verschieben der Karte standen beide auf ihr. Jetzt liefern beide
    /// Ausschnitte denselben einen `osm+mastr`-Punkt am OSM-Standort.
    #[test]
    fn randanlage_ergibt_in_beiden_nachbarausschnitten_denselben_punkt() {
        let (links, rechts) = nachbarn();
        let osm = vec![punkt(7.01, 51.25, "gas", None, "osm")];
        let mastr = vec![punkt(6.995, 51.25, "gas", Some(120.0), "mastr")];
        let l = fuehre_energie_zusammen(&osm, &mastr, &links, 2000.0);
        let r = fuehre_energie_zusammen(&osm, &mastr, &rechts, 2000.0);
        assert_eq!(l.len(), 1, "{l:?}");
        assert_eq!(l[0]["properties"]["herkunft"], "osm+mastr");
        assert_eq!(l[0]["geometry"]["coordinates"], json!([7.01, 51.25]));
        assert_eq!(l, r);
    }

    /// Die Randanlage summiert in beiden Ausschnitten dieselben Einheiten: `u2` liegt ~2,4 km
    /// hinter der Kante (außerhalb eines Randes von nur einem Radius), gehört aber zu `o`.
    #[test]
    fn randanlage_summiert_in_beiden_ausschnitten_dieselben_einheiten() {
        let (links, rechts) = nachbarn();
        let osm = vec![punkt(7.02, 51.25, "wind", None, "osm")];
        let mastr = vec![
            punkt(6.999, 51.25, "wind", Some(12.0), "mastr"),
            punkt(7.035, 51.25, "wind", Some(15.0), "mastr"),
        ];
        let l = fuehre_energie_zusammen(&osm, &mastr, &links, 2000.0);
        let r = fuehre_energie_zusammen(&osm, &mastr, &rechts, 2000.0);
        assert_eq!(l.len(), 1, "{l:?}");
        assert_eq!(l[0]["properties"]["mastr_einheiten"], json!(2));
        assert_eq!(l[0]["properties"]["leistung_mw"], json!(27.0));
        assert_eq!(l, r);
    }

    /// Die zweite Stufe desselben Randfalls: die OSM-Anlage `o` (rechts) bekommt ihre
    /// Einheit `u1` aus dem linken Ausschnitt; eine zweite Einheit `u2` liegt zwar im
    /// Radius von `o`, gehört aber zur noch näheren Anlage `o3` weiter östlich. Links darf
    /// `o` deshalb nicht plötzlich zwei Einheiten tragen, nur weil `o3` dort nicht gesehen
    /// wird. Das belegt den erweiterten Rand über den Radius hinaus (Einheiten 2 r,
    /// OSM 3 r) — mit einem Rand von nur einem Radius stünde links `mastr_einheiten: 2`.
    #[test]
    fn randanlage_zaehlt_in_beiden_ausschnitten_dieselben_einheiten() {
        let (links, rechts) = nachbarn();
        let osm = vec![
            punkt(7.02, 51.25, "wind", Some(30.0), "osm"), // o
            punkt(7.07, 51.25, "wind", Some(30.0), "osm"), // o3, ~4,9 km hinter der Kante
        ];
        let mastr = vec![
            punkt(6.999, 51.25, "wind", Some(12.0), "mastr"), // u1 → o (~1,5 km)
            punkt(7.048, 51.25, "wind", Some(15.0), "mastr"), // u2 → o3 (~1,5 km statt ~1,9 km)
        ];
        let an_o = |fs: &[Value]| {
            fs.iter()
                .find(|f| f["geometry"]["coordinates"] == json!([7.02, 51.25]))
                .cloned()
                .expect("Punkt an o fehlt")
        };
        let l = fuehre_energie_zusammen(&osm, &mastr, &links, 2000.0);
        let r = fuehre_energie_zusammen(&osm, &mastr, &rechts, 2000.0);
        assert_eq!(
            l.len(),
            1,
            "o3 und u2 liegen beide ausserhalb von links: {l:?}"
        );
        assert_eq!(an_o(&l)["properties"]["mastr_einheiten"], json!(1));
        assert_eq!(an_o(&l), an_o(&r));
    }

    // ---- MaStR-Nummern aller Einheiten (Review-Befund 3)

    #[test]
    fn mastr_nummern_nennt_alle_einheiten_sortiert() {
        let osm = vec![
            punkt(7.0, 51.5, "speicher", Some(20.0), "osm"),
            punkt(7.3, 51.5, "gas", None, "osm"),
        ];
        let mastr = vec![
            punkt(7.003, 51.5, "speicher", Some(11.0), "mastr"),
            punkt(7.001, 51.5, "speicher", Some(12.5), "mastr"),
            punkt(7.002, 51.5, "speicher", Some(30.0), "mastr"),
            punkt(6.8, 51.2, "wind", Some(15.0), "mastr"),
        ];
        let fs = fuehre_energie_zusammen(&osm, &mastr, &bbox(), 2000.0);
        let nach_herkunft = |h: &str| {
            fs.iter()
                .find(|f| f["properties"]["herkunft"] == h)
                .unwrap_or_else(|| panic!("{h} fehlt"))["properties"]
                .clone()
        };
        assert_eq!(
            nach_herkunft("osm+mastr")["mastr_nummern"],
            "SEE7.001,SEE7.002,SEE7.003"
        );
        // Bestandsfeld unverändert: die Nummer der GRÖSSTEN Einheit.
        assert_eq!(nach_herkunft("osm+mastr")["mastr_nummer"], "SEE7.002");
        assert_eq!(nach_herkunft("mastr")["mastr_nummern"], "SEE6.8");
        let osm_p = nach_herkunft("osm");
        assert!(osm_p.as_object().unwrap().contains_key("mastr_nummern"));
        assert_eq!(osm_p["mastr_nummern"], Value::Null);
    }

    #[test]
    fn normalisierer_fuehren_mastr_nummern() {
        let o = features(&normalisiere_energie_osm(&anlage(Some("gas"), None)));
        let p = o[0]["properties"].as_object().unwrap();
        assert!(p.contains_key("mastr_nummern"));
        assert_eq!(p["mastr_nummern"], Value::Null);
        let roh: Value = serde_json::from_str(MASTR_AUSZUG).unwrap();
        let m = normalisiere_energie_mastr(&roh).unwrap();
        let wkw = m
            .iter()
            .find(|f| f["properties"]["titel"] == "WKW III")
            .unwrap();
        assert_eq!(wkw["properties"]["mastr_nummern"], "SEE980008908440");
    }

    // ---- 1.7 Quellennennung

    #[test]
    fn quellennennung_nur_aus_beitragenden_teilen() {
        let osm = "© OpenStreetMap-Beitragende (ODbL)";
        let mastr = "Marktstammdatenregister, Bundesnetzagentur – dl-de/by-2-0";
        assert_eq!(energie_attribution(true, true), format!("{osm} · {mastr}"));
        assert_eq!(energie_attribution(true, false), osm);
        assert_eq!(energie_attribution(false, true), mastr);
        assert_eq!(energie_attribution(false, false), "");
    }
}
