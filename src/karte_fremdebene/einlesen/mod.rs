//! Einlesen einer fremden Datei in normiertes GeoJSON (Entwurf, „Einlesen“).
//!
//! Erkannt wird am Inhalt, nicht an der Endung: ZIP-Signatur heißt KMZ, `<` als erstes
//! Nicht-Leerzeichen heißt KML, `{` heißt GeoJSON. Das Ergebnis trägt je Objekt nur Geometrie,
//! `name` und `description` als Text; die Grenzen stehen in [`super`].

pub mod geojson;
pub mod kml;
pub mod kmz;
pub mod pruefen;

pub use pruefen::normalize_geometrie;

use super::{
    FremdebeneFehler, BESCHREIBUNG_MAX, DATEI_MAX, GEOJSON_MAX, NAME_MAX, OBJEKTE_MAX,
    OBJEKT_NAME_MAX, STUETZPUNKTE_JE_LINIE_MAX, STUETZPUNKTE_MAX,
};
use serde_json::{json, Map, Value};

/// Ergebnis des Einlesens: das normierte GeoJSON (`FeatureCollection`) und seine Zahlen.
#[derive(Debug, Clone, PartialEq)]
pub struct Normiert {
    pub geojson: String,
    pub objekte: i64,
    pub verworfen: i64,
    /// Name aus der Datei (GeoJSON `name`, KML `Document/name`), gekürzt auf [`NAME_MAX`].
    pub namensvorschlag: Option<String>,
}

/// Zähler gegen die Grenzen einer Datei: Objekte und Stützpunkte über alle Objekte.
#[derive(Debug, Default)]
pub struct Grenzen {
    pub objekte: usize,
    pub stuetzpunkte: usize,
}

impl Grenzen {
    /// Zählt ein Objekt (auch ein später verworfenes); über [`OBJEKTE_MAX`] → `ZuVieleObjekte`.
    pub fn count_objekt(&mut self) -> Result<(), FremdebeneFehler> {
        self.objekte += 1;
        if self.objekte > OBJEKTE_MAX {
            return Err(FremdebeneFehler::ZuVieleObjekte);
        }
        Ok(())
    }

    /// Zählt die Stützpunkte einer Linie, eines Rings oder einer Punktmenge; über
    /// [`STUETZPUNKTE_JE_LINIE_MAX`] je Linie oder [`STUETZPUNKTE_MAX`] gesamt →
    /// `ZuVieleObjekte`.
    pub fn count_stuetzpunkte(&mut self, anzahl: usize) -> Result<(), FremdebeneFehler> {
        if anzahl > STUETZPUNKTE_JE_LINIE_MAX {
            return Err(FremdebeneFehler::ZuVieleObjekte);
        }
        self.stuetzpunkte += anzahl;
        if self.stuetzpunkte > STUETZPUNKTE_MAX {
            return Err(FremdebeneFehler::ZuVieleObjekte);
        }
        Ok(())
    }
}

/// Liest eine hochgeladene Datei; das Format folgt aus dem Inhalt (ZIP → KMZ, `<` → KML,
/// `{` → GeoJSON).
pub fn read_datei(bytes: &[u8]) -> Result<Normiert, FremdebeneFehler> {
    if bytes.len() > DATEI_MAX {
        return Err(FremdebeneFehler::ZuGross);
    }
    let mut grenzen = Grenzen::default();
    if bytes.starts_with(b"PK\x03\x04") {
        return kmz::read_kmz(bytes, &mut grenzen);
    }
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let text = std::str::from_utf8(bytes).map_err(|_| FremdebeneFehler::Unlesbar)?;
    match text.trim_start().chars().next() {
        None => Err(FremdebeneFehler::Leer),
        Some('{') => geojson::read_geojson(text, &mut grenzen),
        Some('<') => kml::read_kml(text, &mut grenzen),
        Some(_) => Err(FremdebeneFehler::Unlesbar),
    }
}

/// Ein normiertes Objekt: Geometrie und nur `name` und `description` als Properties.
pub fn build_feature(geometrie: Value, name: Option<&str>, beschreibung: Option<&str>) -> Value {
    let mut props = Map::new();
    if let Some(n) = name.map(clean_name).filter(|n| !n.is_empty()) {
        props.insert("name".into(), Value::String(n));
    }
    if let Some(b) = beschreibung
        .map(|b| html_zu_text(kappe(b, BESCHREIBUNG_ROH_MAX)))
        .filter(|b| !b.is_empty())
    {
        props.insert(
            "description".into(),
            Value::String(kuerze(&b, BESCHREIBUNG_MAX)),
        );
    }
    json!({ "type": "Feature", "geometry": geometrie, "properties": props })
}

/// Schließt das Einlesen ab: keine Objekte → `Leer`, zu großes Ergebnis → `ZuUmfangreich`.
pub fn finish(
    features: Vec<Value>,
    verworfen: i64,
    namensvorschlag: Option<&str>,
) -> Result<Normiert, FremdebeneFehler> {
    if features.is_empty() {
        return Err(FremdebeneFehler::Leer);
    }
    let objekte = features.len() as i64;
    let geojson = json!({ "type": "FeatureCollection", "features": features }).to_string();
    if geojson.len() > GEOJSON_MAX {
        return Err(FremdebeneFehler::ZuUmfangreich);
    }
    let namensvorschlag = namensvorschlag
        .map(clean_name)
        .filter(|n| !n.is_empty())
        .map(|n| kuerze(&n, NAME_MAX));
    Ok(Normiert {
        geojson,
        objekte,
        verworfen,
        namensvorschlag,
    })
}

fn kuerze(s: &str, max: usize) -> String {
    s.chars()
        .take(max)
        .collect::<String>()
        .trim_end()
        .to_string()
}

/// Name eines Objekts: Leerraum zusammengezogen, gekürzt auf [`OBJEKT_NAME_MAX`].
fn clean_name(s: &str) -> String {
    kuerze(
        &s.split_whitespace().collect::<Vec<_>>().join(" "),
        OBJEKT_NAME_MAX,
    )
}

/// So viele Bytes einer Beschreibung werden höchstens angesehen: mehr als [`BESCHREIBUNG_MAX`]
/// Zeichen Text bleiben ohnehin nicht, der Rest wäre nur Arbeit (Abschluss-Review, I1).
const BESCHREIBUNG_ROH_MAX: usize = 16 * BESCHREIBUNG_MAX;

/// Kürzt auf höchstens `max` Bytes, an einer Zeichengrenze.
fn kappe(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut ende = max;
    while !s.is_char_boundary(ende) {
        ende -= 1;
    }
    &s[..ende]
}

/// Die Stelle des nächsten `</name` (ohne Rücksicht auf Groß- und Kleinschreibung), ohne Kopie.
fn finde_schluss(text: &str, name: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    let mut ab = 0;
    while let Some(p) = text[ab..].find("</") {
        let i = ab + p;
        let kandidat = bytes.get(i + 2..i + 2 + name.len())?;
        if kandidat.eq_ignore_ascii_case(name.as_bytes()) {
            return Some(i);
        }
        ab = i + 2;
    }
    None
}

/// Beschreibung als reiner Text: Tags entfernt (Inhalt von `script` und `style` mit),
/// Entities aufgelöst, Leerraum zusammengezogen. Ein `<`, dem kein Tag folgt, bleibt Text.
/// Linear in der Länge: jede Suche beginnt dort, wo die vorige aufhörte.
pub fn html_zu_text(s: &str) -> String {
    let mut roh = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(pos) = rest.find('<') {
        roh.push_str(&rest[..pos]);
        let nach = &rest[pos + 1..];
        let ist_tag = nach
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || matches!(c, '/' | '!' | '?'));
        if !ist_tag {
            roh.push('<');
            rest = nach;
            continue;
        }
        let Some(ende) = nach.find('>') else {
            rest = "";
            break;
        };
        let tag = &nach[..ende];
        let tag_name = &tag[..tag
            .find(|c: char| !c.is_ascii_alphanumeric())
            .unwrap_or(tag.len())];
        rest = &nach[ende + 1..];
        roh.push(' ');
        if tag_name.eq_ignore_ascii_case("script") || tag_name.eq_ignore_ascii_case("style") {
            match finde_schluss(rest, tag_name) {
                Some(p) => {
                    let nach_schluss = &rest[p..];
                    rest = nach_schluss
                        .find('>')
                        .map_or("", |e| &nach_schluss[e + 1..]);
                }
                None => rest = "",
            }
        }
    }
    roh.push_str(rest);
    entities_aufloesen(&roh)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn entities_aufloesen(s: &str) -> String {
    let mut aus = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(pos) = rest.find('&') {
        aus.push_str(&rest[..pos]);
        let nach = &rest[pos + 1..];
        let ersatz = nach.find(';').filter(|&e| e <= 10).and_then(|e| {
            let name = &nach[..e];
            let zeichen = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                _ => name
                    .strip_prefix("#x")
                    .or_else(|| name.strip_prefix("#X"))
                    .and_then(|h| u32::from_str_radix(h, 16).ok())
                    .or_else(|| name.strip_prefix('#').and_then(|d| d.parse().ok()))
                    .and_then(char::from_u32),
            };
            zeichen.map(|z| (z, e))
        });
        match ersatz {
            Some((z, e)) => {
                aus.push(z);
                rest = &nach[e + 1..];
            }
            None => {
                aus.push('&');
                rest = nach;
            }
        }
    }
    aus.push_str(rest);
    aus
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lies(text: &str) -> Result<Normiert, FremdebeneFehler> {
        read_datei(text.as_bytes())
    }

    fn features(n: &Normiert) -> Vec<Value> {
        let v: Value = serde_json::from_str(&n.geojson).unwrap();
        assert_eq!(v["type"], "FeatureCollection");
        v["features"].as_array().unwrap().clone()
    }

    #[test]
    fn geojson_featurecollection_wird_normiert() {
        let n = lies(
            r#"{"type":"FeatureCollection","name":"Hydranten Nord",
                "crs":{"type":"name","properties":{"name":"urn:ogc:def:crs:EPSG::3857"}},
                "features":[
                  {"type":"Feature","id":7,
                   "properties":{"name":"H 12","description":"DN 100","farbe":"rot","nr":12},
                   "geometry":{"type":"Point","coordinates":[9.123456789,52.987654321,57.5]}},
                  {"type":"Feature","properties":{"name":"Leitung"},
                   "geometry":{"type":"LineString","coordinates":[[9.1,52.1],[9.2,52.2]]}}
                ]}"#,
        )
        .unwrap();
        assert_eq!((n.objekte, n.verworfen), (2, 0));
        assert_eq!(n.namensvorschlag.as_deref(), Some("Hydranten Nord"));
        let f = features(&n);
        assert_eq!(
            f[0],
            json!({"type":"Feature",
                   "geometry":{"type":"Point","coordinates":[9.123457,52.987654]},
                   "properties":{"name":"H 12","description":"DN 100"}})
        );
        assert_eq!(f[1]["properties"], json!({"name":"Leitung"}));
        assert_eq!(
            f[1]["geometry"]["coordinates"],
            json!([[9.1, 52.1], [9.2, 52.2]])
        );
    }

    #[test]
    fn nackte_geometrie_und_geometrycollection() {
        let n = lies(r#"{"type":"Polygon","coordinates":[[[9,52],[9.1,52],[9.1,52.1]]]}"#).unwrap();
        let f = features(&n);
        assert_eq!(f.len(), 1);
        // Der offene Ring wird geschlossen.
        assert_eq!(
            f[0]["geometry"]["coordinates"],
            json!([[[9.0, 52.0], [9.1, 52.0], [9.1, 52.1], [9.0, 52.0]]])
        );
        assert_eq!(f[0]["properties"], json!({}));

        let n = lies(
            r#"{"type":"Feature","properties":{"name":"Lage"},"geometry":
                {"type":"GeometryCollection","geometries":[
                  {"type":"Point","coordinates":[9,52]},
                  {"type":"GeometryCollection","geometries":[
                    {"type":"LineString","coordinates":[[9,52],[9.5,52.5]]},
                    {"type":"Kreis","coordinates":[9,52]}]}]}}"#,
        )
        .unwrap();
        let g = &features(&n)[0]["geometry"];
        assert_eq!(g["type"], "GeometryCollection");
        let teile = g["geometries"].as_array().unwrap();
        assert_eq!(
            teile
                .iter()
                .map(|t| t["type"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["Point", "LineString"],
            "flachgeklopft, Unbekanntes fällt weg"
        );

        let n = lies(
            r#"{"type":"GeometryCollection","geometries":[{"type":"Point","coordinates":[9,52]}]}"#,
        )
        .unwrap();
        assert_eq!(features(&n)[0]["geometry"]["type"], "Point");
    }

    #[test]
    fn mercator_meter_sind_koordinatenfehler() {
        let r = lies(
            r#"{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},
                "geometry":{"type":"Point","coordinates":[1113194.9,6800125.4]}}]}"#,
        );
        assert_eq!(r, Err(FremdebeneFehler::Koordinaten));
        // Nur die Länge in Metern, die Breite sähe nach Grad aus: auch das ist ein Fehler.
        let r = lies(r#"{"type":"Point","coordinates":[1113194.9,52.5]}"#);
        assert_eq!(r, Err(FremdebeneFehler::Koordinaten));
        let r = lies(r#"{"type":"LineString","coordinates":[[9,52],[9,95]]}"#);
        assert_eq!(r, Err(FremdebeneFehler::Koordinaten));
    }

    #[test]
    fn objekt_ohne_geometrie_wird_gezaehlt() {
        let n = lies(
            r#"{"type":"FeatureCollection","features":[
                {"type":"Feature","properties":{"name":"ohne"},"geometry":null},
                {"type":"Feature","properties":{"name":"kaputt"},
                 "geometry":{"type":"LineString","coordinates":[[9,52]]}},
                {"type":"Feature","properties":{"name":"Text"},
                 "geometry":{"type":"Point","coordinates":["9","52"]}},
                {"type":"Feature","properties":{"name":"gut"},
                 "geometry":{"type":"Point","coordinates":[9,52]}}]}"#,
        )
        .unwrap();
        assert_eq!((n.objekte, n.verworfen), (1, 3));
        assert_eq!(features(&n)[0]["properties"]["name"], "gut");
    }

    #[test]
    fn zu_viele_objekte() {
        let punkt = r#"{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[9,52]}}"#;
        let erlaubt = vec![punkt; OBJEKTE_MAX].join(",");
        let n = lies(&format!(
            r#"{{"type":"FeatureCollection","features":[{erlaubt}]}}"#
        ))
        .unwrap();
        assert_eq!(n.objekte, OBJEKTE_MAX as i64);
        let zuviel = vec![punkt; OBJEKTE_MAX + 1].join(",");
        assert_eq!(
            lies(&format!(
                r#"{{"type":"FeatureCollection","features":[{zuviel}]}}"#
            )),
            Err(FremdebeneFehler::ZuVieleObjekte)
        );
    }

    #[test]
    fn zu_viele_stuetzpunkte_je_ring() {
        let ring = |n: usize| {
            let mut p: Vec<String> = (0..n - 1)
                .map(|i| format!("[{},52]", 9.0 + i as f64 * 1e-5))
                .collect();
            p.push("[9,52]".into());
            p.join(",")
        };
        let polygon = |n: usize| format!(r#"{{"type":"Polygon","coordinates":[[{}]]}}"#, ring(n));
        assert!(lies(&polygon(STUETZPUNKTE_JE_LINIE_MAX)).is_ok());
        assert_eq!(
            lies(&polygon(STUETZPUNKTE_JE_LINIE_MAX + 1)),
            Err(FremdebeneFehler::ZuVieleObjekte)
        );
        // Gesamtgrenze über viele erlaubte Linien.
        let linie = format!(
            r#"{{"type":"Feature","properties":{{}},"geometry":{{"type":"LineString","coordinates":[{}]}}}}"#,
            ring(STUETZPUNKTE_JE_LINIE_MAX)
        );
        let anzahl = STUETZPUNKTE_MAX / STUETZPUNKTE_JE_LINIE_MAX + 1;
        let alle = vec![linie.as_str(); anzahl].join(",");
        assert_eq!(
            lies(&format!(
                r#"{{"type":"FeatureCollection","features":[{alle}]}}"#
            )),
            Err(FremdebeneFehler::ZuVieleObjekte)
        );
    }

    #[test]
    fn leere_datei_ist_leer() {
        assert_eq!(read_datei(b""), Err(FremdebeneFehler::Leer));
        assert_eq!(lies(" \n\t"), Err(FremdebeneFehler::Leer));
        assert_eq!(
            lies(r#"{"type":"FeatureCollection","features":[]}"#),
            Err(FremdebeneFehler::Leer)
        );
        assert_eq!(
            lies(r#"{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null}]}"#),
            Err(FremdebeneFehler::Leer)
        );
        // Kein GeoJSON: unlesbar, nicht leer.
        assert_eq!(lies("{kaputt"), Err(FremdebeneFehler::Unlesbar));
        assert_eq!(
            lies(r#"{"type":"Topology"}"#),
            Err(FremdebeneFehler::Unlesbar)
        );
        assert_eq!(lies("name;lat;lon"), Err(FremdebeneFehler::Unlesbar));
        assert_eq!(
            read_datei(&[0xff, 0xfe, 0x7b]),
            Err(FremdebeneFehler::Unlesbar)
        );
    }

    #[test]
    fn html_in_description_wird_text() {
        let n = lies(
            r#"{"type":"Feature","properties":{"name":"  Sammel\nstelle  ",
                "description":"<p>Hydrant <b>DN&nbsp;100</b></p><script>alert(1)</script>&amp; a < b <img src=x onerror=alert(2)>"},
                "geometry":{"type":"Point","coordinates":[9,52]}}"#,
        )
        .unwrap();
        let p = &features(&n)[0]["properties"];
        assert_eq!(p["name"], "Sammel stelle");
        assert_eq!(p["description"], "Hydrant DN 100 & a < b");
        let lang = "x".repeat(BESCHREIBUNG_MAX + 50);
        let n = lies(&format!(
            r#"{{"type":"Feature","properties":{{"name":"{}","description":"{lang}"}},
                "geometry":{{"type":"Point","coordinates":[9,52]}}}}"#,
            "n".repeat(OBJEKT_NAME_MAX + 5)
        ))
        .unwrap();
        let p = &features(&n)[0]["properties"];
        assert_eq!(
            p["description"].as_str().unwrap().chars().count(),
            BESCHREIBUNG_MAX
        );
        assert_eq!(p["name"].as_str().unwrap().chars().count(), OBJEKT_NAME_MAX);
    }

    #[test]
    fn zu_grosse_datei_wird_vor_dem_lesen_abgelehnt() {
        assert_eq!(
            read_datei(&vec![b' '; DATEI_MAX + 1]),
            Err(FremdebeneFehler::ZuGross)
        );
        let mut kmz = b"PK\x03\x04".to_vec();
        kmz.resize(DATEI_MAX + 1, 0);
        assert_eq!(read_datei(&kmz), Err(FremdebeneFehler::ZuGross));
    }

    #[test]
    fn viele_script_tags_bleiben_linear() {
        let viele = format!(
            "{}Text",
            "<script>x</script><STYLE>y</Style >".repeat(50_000)
        );
        let start = std::time::Instant::now();
        assert_eq!(html_zu_text(&viele), "Text");
        assert!(
            start.elapsed() < std::time::Duration::from_secs(2),
            "{:?}",
            start.elapsed()
        );
        assert_eq!(html_zu_text("a<SCRIPT>b</ScRiPt >c"), "a c");
        assert_eq!(html_zu_text("a<script>b"), "a");
    }

    #[test]
    fn beschreibung_wird_vor_dem_entfernen_gekappt() {
        // Nach dem 16-Fachen von BESCHREIBUNG_MAX Bytes ist Schluss, auch mitten in einem Zeichen.
        let leer = "<p></p>".repeat(BESCHREIBUNG_MAX * 16 / 7 + 1);
        let f = build_feature(json!(null), None, Some(&format!("{leer}Ende")));
        assert_eq!(f["properties"], json!({}));
        let umlaute = format!("x{}", "ä".repeat(BESCHREIBUNG_MAX * 16));
        let f = build_feature(json!(null), None, Some(&umlaute));
        assert_eq!(
            f["properties"]["description"]
                .as_str()
                .unwrap()
                .chars()
                .count(),
            BESCHREIBUNG_MAX
        );
    }

    #[test]
    fn zu_grosses_ergebnis_ist_zu_umfangreich() {
        let f =
            json!({"type":"Feature","geometry":null,"properties":{"x":"a".repeat(GEOJSON_MAX)}});
        assert_eq!(
            finish(vec![f], 0, None),
            Err(FremdebeneFehler::ZuUmfangreich)
        );
    }
}
