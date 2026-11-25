//! KML lesen (Entwurf, „Einlesen“): ein Ereignisleser über den Text, nie ein Baum.
//!
//! Sicherheit: Eine DTD (`<!DOCTYPE …>`) lehnt die ganze Datei sofort ab (`Dtd`), damit weder
//! Billion Laughs noch externe Entities eine Gelegenheit bekommen. Entity-Referenzen löst der
//! Leser selbst auf, und nur die fünf vordefinierten und Zeichenreferenzen; jede andere ist
//! `Unlesbar`. Verfolgt wird nichts: `NetworkLink`, `Icon`, `Link`, `Style` und `ExtendedData`
//! werden samt Inhalt überlesen, ein `href` erreicht nie das Ergebnis.
//!
//! Gelesen werden `Placemark` mit `name`, `description` und den Geometrien `Point`,
//! `LineString`, `LinearRing` (allein eine geschlossene Linie), `Polygon` (äußerer und innere
//! Ringe), `MultiGeometry` und `gx:Track`/`gx:MultiTrack` (als Linie). Die Rohgeometrie geht als
//! GeoJSON durch [`normalize_geometrie`], also durch dieselbe Bereichsprüfung und dieselben
//! Grenzen wie eine GeoJSON-Datei. Der `name` des äußersten `Document` ist der Namensvorschlag.

use super::{build_feature, finish, normalize_geometrie, Grenzen, Normiert};
use crate::karte_fremdebene::{
    FremdebeneFehler, GEOMETRIE_TIEFE_MAX, STUETZPUNKTE_JE_LINIE_MAX, STUETZPUNKTE_MAX,
};
use quick_xml::events::{BytesRef, Event};
use quick_xml::Reader;
use serde_json::{json, Value};

/// Elemente, die samt Inhalt überlesen werden: Verweise nach außen und Darstellung.
const UEBERLESEN: &[&str] = &[
    "NetworkLink",
    "NetworkLinkControl",
    "Link",
    "Icon",
    "Style",
    "StyleMap",
    "ExtendedData",
    "Schema",
    "Region",
    "GroundOverlay",
    "ScreenOverlay",
    "PhotoOverlay",
    "Model",
    "Camera",
    "LookAt",
    "Tour",
];

/// Wessen Text gerade gesammelt wird.
#[derive(Clone, Copy, PartialEq)]
enum Textziel {
    DocumentName,
    Name,
    Beschreibung,
    Koordinaten,
    TrackKoordinate,
}

/// Eine offene Geometrie in einem Placemark.
enum Rahmen {
    Punkt(Option<Vec<Value>>),
    /// `LineString` oder ein `LinearRing`; `rolle` sagt, wohin ein Ring gehört.
    Linie {
        koordinaten: Option<Vec<Value>>,
        rolle: Rolle,
    },
    Polygon {
        aussen: Option<Vec<Value>>,
        innen: Vec<Vec<Value>>,
        kaputt: bool,
    },
    Track(Vec<Value>),
    Mehrere(Vec<Value>),
}

#[derive(Clone, Copy, PartialEq)]
enum Rolle {
    Linie,
    Ring,
    Aussen,
    Innen,
}

#[derive(Default)]
struct Placemark {
    tiefe: usize,
    name: Option<String>,
    beschreibung: Option<String>,
    rahmen: Vec<Rahmen>,
    geometrien: Vec<Value>,
}

/// Zählt die rohen Stützpunkte, bevor sie wachsen; die Grenzen selbst prüft der Normierer.
struct Roh {
    punkte: usize,
}

impl Roh {
    fn zaehle(&mut self, anzahl: usize) -> Result<(), FremdebeneFehler> {
        self.punkte += anzahl;
        if self.punkte > STUETZPUNKTE_MAX {
            return Err(FremdebeneFehler::ZuVieleObjekte);
        }
        Ok(())
    }
}

pub fn read_kml(text: &str, grenzen: &mut Grenzen) -> Result<Normiert, FremdebeneFehler> {
    let mut leser = Reader::from_str(text);
    let config = leser.config_mut();
    config.expand_empty_elements = true;
    config.check_end_names = true;

    let unlesbar = |_| FremdebeneFehler::Unlesbar;
    let mut pfad: Vec<String> = Vec::new();
    let mut ueberlesen_ab: Option<usize> = None;
    let mut placemark: Option<Placemark> = None;
    let mut text_ziel: Option<(Textziel, usize)> = None;
    let mut puffer = String::new();
    let mut roh = Roh { punkte: 0 };
    let mut namensvorschlag: Option<String> = None;
    let mut wurzel_gesehen = false;
    let mut features = Vec::new();
    let mut verworfen = 0i64;

    loop {
        match leser.read_event().map_err(unlesbar)? {
            Event::DocType(_) => return Err(FremdebeneFehler::Dtd),
            Event::Eof => break,
            Event::Start(e) => {
                let name = e.local_name().as_ref().to_string();
                if pfad.is_empty() {
                    if wurzel_gesehen || name != "kml" {
                        return Err(FremdebeneFehler::Unlesbar);
                    }
                    wurzel_gesehen = true;
                }
                let eltern = pfad.last().map(String::as_str);
                let tiefe = pfad.len();
                if ueberlesen_ab.is_none() && text_ziel.is_none() {
                    if UEBERLESEN.contains(&name.as_str()) {
                        ueberlesen_ab = Some(tiefe);
                    } else if let Some(p) = placemark.as_mut() {
                        oeffne_in_placemark(p, &name, eltern, tiefe, &mut text_ziel)?;
                    } else if name == "Placemark" {
                        grenzen.count_objekt()?;
                        placemark = Some(Placemark {
                            tiefe,
                            ..Placemark::default()
                        });
                    } else if name == "name"
                        && eltern == Some("Document")
                        && namensvorschlag.is_none()
                        && !pfad[..tiefe - 1].iter().any(|n| n == "Document")
                    {
                        text_ziel = Some((Textziel::DocumentName, tiefe));
                    }
                    if text_ziel.is_some_and(|(_, t)| t == tiefe) {
                        puffer.clear();
                    }
                }
                pfad.push(name);
            }
            Event::End(_) => {
                let name = pfad.pop().ok_or(FremdebeneFehler::Unlesbar)?;
                let tiefe = pfad.len();
                if let Some(ab) = ueberlesen_ab {
                    if ab == tiefe {
                        ueberlesen_ab = None;
                    }
                    continue;
                }
                if let Some((ziel, t)) = text_ziel {
                    if t != tiefe {
                        continue;
                    }
                    text_ziel = None;
                    let inhalt = std::mem::take(&mut puffer);
                    match ziel {
                        Textziel::DocumentName => namensvorschlag = Some(inhalt),
                        _ => {
                            if let Some(p) = placemark.as_mut() {
                                schliesse_text(p, ziel, &inhalt, &mut roh)?;
                            }
                        }
                    }
                    continue;
                }
                let Some(p) = placemark.as_mut() else {
                    continue;
                };
                if tiefe == p.tiefe {
                    let p = placemark.take().expect("offenes Placemark");
                    match placemark_geometrie(p.geometrien) {
                        Some(g) => match normalize_geometrie(&g, grenzen)? {
                            Some(g) => features.push(build_feature(
                                zusammenfassen(g),
                                p.name.as_deref(),
                                p.beschreibung.as_deref(),
                            )),
                            None => verworfen += 1,
                        },
                        None => verworfen += 1,
                    }
                } else {
                    schliesse_geometrie(p, &name);
                }
            }
            Event::Text(t) => {
                if text_ziel.is_some() && ueberlesen_ab.is_none() {
                    puffer.push_str(&t.xml10_content());
                }
            }
            Event::CData(c) => {
                if text_ziel.is_some() && ueberlesen_ab.is_none() {
                    puffer.push_str(&c.into_inner());
                }
            }
            Event::GeneralRef(r) => {
                let zeichen = entity(&r)?;
                if text_ziel.is_some() && ueberlesen_ab.is_none() {
                    puffer.push(zeichen);
                }
            }
            // Mit `expand_empty_elements` kommt ein leeres Element als Start und Ende; Kommentare,
            // Deklaration und Verarbeitungsanweisungen zählen nicht.
            _ => {}
        }
    }
    if !pfad.is_empty() || !wurzel_gesehen {
        return Err(FremdebeneFehler::Unlesbar);
    }
    finish(features, verworfen, namensvorschlag.as_deref())
}

/// Nur die fünf vordefinierten Entities und Zeichenreferenzen; alles andere ist unlesbar.
fn entity(r: &BytesRef<'_>) -> Result<char, FremdebeneFehler> {
    if r.is_char_ref() {
        return r
            .resolve_char_ref()
            .ok()
            .flatten()
            .ok_or(FremdebeneFehler::Unlesbar);
    }
    match r.xml10_content().as_ref() {
        "lt" => Ok('<'),
        "gt" => Ok('>'),
        "amp" => Ok('&'),
        "quot" => Ok('"'),
        "apos" => Ok('\''),
        _ => Err(FremdebeneFehler::Unlesbar),
    }
}

/// Elemente, die eine Geometrie öffnen (einen [`Rahmen`]).
const GEOMETRIEN: &[&str] = &[
    "Point",
    "LineString",
    "LinearRing",
    "Polygon",
    "Track",
    "MultiGeometry",
    "MultiTrack",
];

/// Ein Element innerhalb eines Placemark beginnt. Mehr als [`GEOMETRIE_TIEFE_MAX`] offene
/// Geometrien machen die Datei `Unlesbar`: sonst wüchse der Wert so tief, wie die Datei
/// schachtelt, und Normieren wie Freigeben gingen rekursiv über den Stack.
fn oeffne_in_placemark(
    p: &mut Placemark,
    name: &str,
    eltern: Option<&str>,
    tiefe: usize,
    text_ziel: &mut Option<(Textziel, usize)>,
) -> Result<(), FremdebeneFehler> {
    if GEOMETRIEN.contains(&name) && p.rahmen.len() >= GEOMETRIE_TIEFE_MAX {
        return Err(FremdebeneFehler::Unlesbar);
    }
    let in_geometrie = !p.rahmen.is_empty();
    match name {
        "name" if eltern == Some("Placemark") => *text_ziel = Some((Textziel::Name, tiefe)),
        "description" if eltern == Some("Placemark") => {
            *text_ziel = Some((Textziel::Beschreibung, tiefe))
        }
        "coordinates" if in_geometrie => *text_ziel = Some((Textziel::Koordinaten, tiefe)),
        "coord" if matches!(p.rahmen.last(), Some(Rahmen::Track(_))) => {
            *text_ziel = Some((Textziel::TrackKoordinate, tiefe))
        }
        "Point" => p.rahmen.push(Rahmen::Punkt(None)),
        "LineString" => p.rahmen.push(Rahmen::Linie {
            koordinaten: None,
            rolle: Rolle::Linie,
        }),
        "LinearRing" => {
            let rolle = match (eltern, p.rahmen.last()) {
                (Some("outerBoundaryIs"), Some(Rahmen::Polygon { .. })) => Rolle::Aussen,
                (Some("innerBoundaryIs"), Some(Rahmen::Polygon { .. })) => Rolle::Innen,
                _ => Rolle::Ring,
            };
            p.rahmen.push(Rahmen::Linie {
                koordinaten: None,
                rolle,
            });
        }
        "Polygon" => p.rahmen.push(Rahmen::Polygon {
            aussen: None,
            innen: Vec::new(),
            kaputt: false,
        }),
        "Track" => p.rahmen.push(Rahmen::Track(Vec::new())),
        "MultiGeometry" | "MultiTrack" => p.rahmen.push(Rahmen::Mehrere(Vec::new())),
        _ => {}
    }
    Ok(())
}

/// Der gesammelte Text eines Elements im Placemark.
fn schliesse_text(
    p: &mut Placemark,
    ziel: Textziel,
    inhalt: &str,
    roh: &mut Roh,
) -> Result<(), FremdebeneFehler> {
    match ziel {
        Textziel::Name => p.name = Some(inhalt.to_string()),
        Textziel::Beschreibung => p.beschreibung = Some(inhalt.to_string()),
        Textziel::Koordinaten => {
            let k = koordinaten(inhalt, roh)?;
            match p.rahmen.last_mut() {
                Some(Rahmen::Punkt(c)) | Some(Rahmen::Linie { koordinaten: c, .. }) => *c = Some(k),
                _ => {}
            }
        }
        Textziel::TrackKoordinate => {
            if let Some(Rahmen::Track(c)) = p.rahmen.last_mut() {
                if c.len() <= STUETZPUNKTE_JE_LINIE_MAX {
                    roh.zaehle(1)?;
                    c.push(position(inhalt.split_whitespace()));
                }
            }
        }
        Textziel::DocumentName => {}
    }
    Ok(())
}

/// KML-Koordinaten: durch Leerraum getrennte Tupel `lon,lat[,alt]`; die Höhe fällt weg. Mehr
/// als [`STUETZPUNKTE_JE_LINIE_MAX`] Tupel werden nicht gelesen: eines mehr reicht dem
/// Normierer für die Ablehnung.
fn koordinaten(text: &str, roh: &mut Roh) -> Result<Vec<Value>, FremdebeneFehler> {
    let mut aus = Vec::new();
    for tupel in text.split_whitespace().take(STUETZPUNKTE_JE_LINIE_MAX + 1) {
        roh.zaehle(1)?;
        aus.push(position(tupel.split(',')));
    }
    Ok(aus)
}

/// Eine Position `[lon, lat]`; was keine Zahl ist, wird `null` und macht die Geometrie kaputt.
fn position<'a>(mut teile: impl Iterator<Item = &'a str>) -> Value {
    let mut zahl = || teile.next().and_then(|t| t.trim().parse::<f64>().ok());
    match (zahl(), zahl()) {
        (Some(lon), Some(lat)) => json!([lon, lat]),
        _ => Value::Null,
    }
}

/// Eine Geometrie endet: ihr Rahmen wird GeoJSON und geht an den umgebenden Rahmen oder das
/// Placemark. Eine kaputte Geometrie geht als `null` weiter; der Normierer verwirft sie.
fn schliesse_geometrie(p: &mut Placemark, name: &str) {
    let passt = matches!(
        (name, p.rahmen.last()),
        ("Point", Some(Rahmen::Punkt(_)))
            | ("LineString" | "LinearRing", Some(Rahmen::Linie { .. }))
            | ("Polygon", Some(Rahmen::Polygon { .. }))
            | ("Track", Some(Rahmen::Track(_)))
            | ("MultiGeometry" | "MultiTrack", Some(Rahmen::Mehrere(_)))
    );
    if !passt {
        return;
    }
    let rahmen = p.rahmen.pop().expect("passender Rahmen");
    let geometrie = match rahmen {
        Rahmen::Punkt(Some(mut k)) if !k.is_empty() => {
            json!({ "type": "Point", "coordinates": k.swap_remove(0) })
        }
        Rahmen::Punkt(_) => Value::Null,
        Rahmen::Linie { koordinaten, rolle } => {
            let k = koordinaten.unwrap_or_default();
            match (rolle, p.rahmen.last_mut()) {
                (Rolle::Aussen, Some(Rahmen::Polygon { aussen, kaputt, .. })) => {
                    if aussen.is_some() {
                        *kaputt = true;
                    }
                    *aussen = Some(k);
                    return;
                }
                (Rolle::Innen, Some(Rahmen::Polygon { innen, .. })) => {
                    innen.push(k);
                    return;
                }
                _ => {}
            }
            let mut k = k;
            if rolle == Rolle::Ring {
                if let (Some(erster), Some(letzter)) = (k.first(), k.last()) {
                    if erster != letzter {
                        k.push(erster.clone());
                    }
                }
            }
            json!({ "type": "LineString", "coordinates": k })
        }
        Rahmen::Polygon {
            aussen: Some(aussen),
            innen,
            kaputt: false,
        } => {
            let mut ringe = vec![aussen];
            ringe.extend(innen);
            json!({ "type": "Polygon", "coordinates": ringe })
        }
        Rahmen::Polygon { .. } => Value::Null,
        Rahmen::Track(k) => json!({ "type": "LineString", "coordinates": k }),
        Rahmen::Mehrere(teile) => json!({ "type": "GeometryCollection", "geometries": teile }),
    };
    match p.rahmen.last_mut() {
        Some(Rahmen::Mehrere(teile)) => teile.push(geometrie),
        // Eine Geometrie in einer anderen (etwa ein Punkt im Polygon) gilt nicht.
        Some(_) => {}
        None => p.geometrien.push(geometrie),
    }
}

/// Die Geometrie eines Placemark: eine allein, mehrere (ungültiges KML) als Sammlung.
fn placemark_geometrie(mut geometrien: Vec<Value>) -> Option<Value> {
    match geometrien.len() {
        0 => None,
        1 => geometrien.pop(),
        _ => Some(json!({ "type": "GeometryCollection", "geometries": geometrien })),
    }
}

/// Eine normierte Sammlung aus lauter Teilen einer Art wird die passende Multi-Geometrie.
fn zusammenfassen(g: Value) -> Value {
    let Some(teile) = g.get("geometries").and_then(Value::as_array) else {
        return g;
    };
    let Some(art) = teile.first().and_then(|t| t["type"].as_str()) else {
        return g;
    };
    let multi = match art {
        "Point" => "MultiPoint",
        "LineString" => "MultiLineString",
        "Polygon" => "MultiPolygon",
        _ => return g,
    };
    if teile.iter().any(|t| t["type"] != art) {
        return g;
    }
    let koordinaten: Vec<Value> = teile.iter().map(|t| t["coordinates"].clone()).collect();
    json!({ "type": multi, "coordinates": koordinaten })
}

#[cfg(test)]
mod tests {
    use super::super::read_datei;
    use super::*;
    use crate::karte_fremdebene::{GEOMETRIE_TIEFE_MAX, OBJEKTE_MAX, STUETZPUNKTE_JE_LINIE_MAX};
    use serde_json::{json, Value};

    fn lies(text: &str) -> Result<Normiert, FremdebeneFehler> {
        read_datei(text.as_bytes())
    }

    fn kml(inhalt: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"
     xmlns:atom="http://www.w3.org/2005/Atom">{inhalt}</kml>"#
        )
    }

    fn features(n: &Normiert) -> Vec<Value> {
        let v: Value = serde_json::from_str(&n.geojson).unwrap();
        v["features"].as_array().unwrap().clone()
    }

    fn placemark(geometrie: &str) -> String {
        format!("<Placemark>{geometrie}</Placemark>")
    }

    #[test]
    fn placemarks_punkt_linie_flaeche_multigeometry() {
        let n = lies(&kml(r#"<Document><Folder><name>Ordner</name>
            <Placemark><name>H 12 &amp; Co</name>
              <description><![CDATA[<p>Hydrant <b>DN 100</b></p>]]></description>
              <styleUrl>#rot</styleUrl>
              <Point><coordinates>9.123456789,52.987654321</coordinates></Point></Placemark>
            <Placemark><name>Leitung</name>
              <LineString><tessellate>1</tessellate>
                <coordinates>9.1,52.1 9.2,52.2</coordinates></LineString></Placemark>
            <Placemark><name>Fläche</name><Polygon>
              <outerBoundaryIs><LinearRing><coordinates>
                9,52 9.1,52 9.1,52.1 9,52.1 9,52</coordinates></LinearRing></outerBoundaryIs>
              <innerBoundaryIs><LinearRing><coordinates>
                9.02,52.02 9.05,52.02 9.05,52.05</coordinates></LinearRing></innerBoundaryIs>
            </Polygon></Placemark>
            <Placemark><name>Ring</name><LinearRing><coordinates>
              9,52 9.1,52 9.1,52.1</coordinates></LinearRing></Placemark>
            <Placemark><name>Gemischt</name><MultiGeometry>
              <Point><coordinates>9,52</coordinates></Point>
              <MultiGeometry><LineString><coordinates>9,52 9.5,52.5</coordinates></LineString>
                <LineString><coordinates>9,52</coordinates></LineString></MultiGeometry>
            </MultiGeometry></Placemark>
            <Placemark><name>Zwei Punkte</name><MultiGeometry>
              <Point><coordinates>9,52</coordinates></Point>
              <Point><coordinates>9.1,52.1</coordinates></Point></MultiGeometry></Placemark>
            <Placemark><name>ohne Geometrie</name></Placemark>
            <Placemark><name>kaputt</name><Point><coordinates>neun,52</coordinates></Point></Placemark>
            </Folder></Document>"#))
        .unwrap();
        assert_eq!((n.objekte, n.verworfen), (6, 2));
        let f = features(&n);
        assert_eq!(
            f[0],
            json!({"type":"Feature",
                   "geometry":{"type":"Point","coordinates":[9.123457,52.987654]},
                   "properties":{"name":"H 12 & Co","description":"Hydrant DN 100"}})
        );
        assert_eq!(
            f[1]["geometry"],
            json!({"type":"LineString","coordinates":[[9.1,52.1],[9.2,52.2]]})
        );
        assert_eq!(f[1]["properties"], json!({"name":"Leitung"}));
        assert_eq!(
            f[2]["geometry"],
            json!({"type":"Polygon","coordinates":[
                [[9.0,52.0],[9.1,52.0],[9.1,52.1],[9.0,52.1],[9.0,52.0]],
                [[9.02,52.02],[9.05,52.02],[9.05,52.05],[9.02,52.02]]]})
        );
        // Ein Ring allein ist eine geschlossene Linie.
        assert_eq!(
            f[3]["geometry"],
            json!({"type":"LineString","coordinates":
                [[9.0,52.0],[9.1,52.0],[9.1,52.1],[9.0,52.0]]})
        );
        assert_eq!(
            f[4]["geometry"],
            json!({"type":"GeometryCollection","geometries":[
                {"type":"Point","coordinates":[9.0,52.0]},
                {"type":"LineString","coordinates":[[9.0,52.0],[9.5,52.5]]}]}),
            "verschachtelt flachgeklopft, die kaputte Linie fällt weg"
        );
        assert_eq!(
            f[5]["geometry"],
            json!({"type":"MultiPoint","coordinates":[[9.0,52.0],[9.1,52.1]]})
        );
    }

    #[test]
    fn gx_track_wird_linie() {
        let n = lies(&kml(r#"<Document><Placemark><name>Flug 1</name><gx:Track>
              <altitudeMode>absolute</altitudeMode>
              <when>2026-11-24T10:00:00Z</when><when>2026-11-24T10:00:05Z</when>
              <when>2026-11-24T10:00:10Z</when>
              <gx:coord>9.1 52.1 120</gx:coord>
              <gx:coord>9.2 52.2 130.5</gx:coord>
              <gx:coord>9.3 52.3 140</gx:coord>
              <gx:angles>0 0 0</gx:angles>
            </gx:Track></Placemark>
            <Placemark><name>Flüge</name><gx:MultiTrack>
              <gx:Track><gx:coord>9 52 0</gx:coord><gx:coord>9.1 52 0</gx:coord></gx:Track>
              <gx:Track><gx:coord>8 51 0</gx:coord><gx:coord>8.1 51 0</gx:coord></gx:Track>
            </gx:MultiTrack></Placemark></Document>"#))
        .unwrap();
        let f = features(&n);
        assert_eq!(
            f[0]["geometry"],
            json!({"type":"LineString","coordinates":[[9.1,52.1],[9.2,52.2],[9.3,52.3]]})
        );
        assert_eq!(f[0]["properties"], json!({"name":"Flug 1"}));
        assert_eq!(
            f[1]["geometry"],
            json!({"type":"MultiLineString","coordinates":[
                [[9.0,52.0],[9.1,52.0]],[[8.0,51.0],[8.1,51.0]]]})
        );
    }

    #[test]
    fn hoehe_wird_verworfen() {
        let n = lies(&kml(&format!(
            "{}{}",
            placemark("<Point><coordinates> 9.5,52.5,120.3 </coordinates></Point>"),
            placemark(
                "<LineString><coordinates>\n\t9,52,10\n\t9.1,52.1,20.5\n</coordinates></LineString>"
            )
        )))
        .unwrap();
        let f = features(&n);
        assert_eq!(f[0]["geometry"]["coordinates"], json!([9.5, 52.5]));
        assert_eq!(
            f[1]["geometry"]["coordinates"],
            json!([[9.0, 52.0], [9.1, 52.1]])
        );
        assert!(!n.geojson.contains("120"));
    }

    #[test]
    fn document_name_ist_vorschlag() {
        let n = lies(&kml(r#"<Document><name>  Hydranten
              Nord </name><Folder><name>Ordner</name>
            <Placemark><name>H 1</name><Point><coordinates>9,52</coordinates></Point></Placemark>
            </Folder></Document>"#))
        .unwrap();
        assert_eq!(n.namensvorschlag.as_deref(), Some("Hydranten Nord"));
        assert_eq!(features(&n)[0]["properties"]["name"], "H 1");

        // Ohne Document kein Vorschlag, auch nicht aus dem Namen des Objekts.
        let n = lies(&kml(
            "<Placemark><name>H 1</name><Point><coordinates>9,52</coordinates></Point></Placemark>",
        ))
        .unwrap();
        assert_eq!(n.namensvorschlag, None);
    }

    #[test]
    fn doctype_wird_abgelehnt() {
        let billion_laughs = r#"<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
 <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
]>
<kml><Placemark><name>&lol4;</name><Point><coordinates>9,52</coordinates></Point></Placemark></kml>"#;
        assert_eq!(lies(billion_laughs), Err(FremdebeneFehler::Dtd));
        let extern_ = r#"<?xml version="1.0"?>
<!DOCTYPE kml [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<kml><Placemark><name>&xxe;</name><Point><coordinates>9,52</coordinates></Point></Placemark></kml>"#;
        assert_eq!(lies(extern_), Err(FremdebeneFehler::Dtd));
        let nur_doctype = r#"<!DOCTYPE kml SYSTEM "http://example.invalid/kml.dtd"><kml/>"#;
        assert_eq!(lies(nur_doctype), Err(FremdebeneFehler::Dtd));
        // Ohne DTD ist eine unbekannte Entity schlicht unlesbar, nie aufgelöst.
        assert_eq!(
            lies(&kml(&placemark(
                "<name>&xxe;</name><Point><coordinates>9,52</coordinates></Point>"
            ))),
            Err(FremdebeneFehler::Unlesbar)
        );
        // Zeichenreferenzen und die fünf vordefinierten gelten.
        let n = lies(&kml(&placemark(
            "<name>&lt;A&gt; &#x41;&#66; &quot;&apos;</name><Point><coordinates>9,52</coordinates></Point>",
        )))
        .unwrap();
        assert_eq!(features(&n)[0]["properties"]["name"], "<A> AB \"'");
    }

    #[test]
    fn networklink_und_href_werden_nicht_verfolgt() {
        let n = lies(&kml(r#"<Document><name>Lage</name>
            <atom:link href="http://example.invalid/atom"/>
            <Style id="rot"><IconStyle><Icon><href>http://example.invalid/icon.png</href></Icon>
              </IconStyle></Style>
            <NetworkLink><name>Nachladen</name>
              <Link><href>http://example.invalid/mehr.kml</href><refreshMode>onInterval</refreshMode></Link>
            </NetworkLink>
            <GroundOverlay><name>Luftbild</name><Icon><href>http://example.invalid/bild.jpg</href></Icon>
              <LatLonBox><north>53</north><south>52</south><east>10</east><west>9</west></LatLonBox>
            </GroundOverlay>
            <Placemark><name>Sammelstelle</name>
              <ExtendedData><Data name="quelle"><value>http://example.invalid/x</value></Data></ExtendedData>
              <Point><coordinates>9,52</coordinates></Point></Placemark>
            </Document>"#))
        .unwrap();
        assert_eq!((n.objekte, n.verworfen), (1, 0));
        assert_eq!(
            features(&n)[0]["properties"],
            json!({"name":"Sammelstelle"})
        );
        assert_eq!(n.namensvorschlag.as_deref(), Some("Lage"));
        assert!(!n.geojson.contains("example.invalid"));
    }

    #[test]
    fn tief_verschachtelte_multigeometry_wird_abgelehnt_ohne_absturz() {
        let tiefe = 10_000;
        let text = kml(&placemark(&format!(
            "{}{}",
            "<MultiGeometry>".repeat(tiefe),
            "</MultiGeometry>".repeat(tiefe)
        )));
        // Ein kleiner Stack beweist, dass nichts rekursiv in die Tiefe geht.
        let ergebnis = std::thread::Builder::new()
            .stack_size(256 * 1024)
            .spawn(move || lies(&text))
            .unwrap()
            .join()
            .expect("kein Absturz");
        assert_eq!(ergebnis, Err(FremdebeneFehler::Unlesbar));

        // Bis zur Grenze offener Geometrien wird gelesen.
        let punkt = "<Point><coordinates>9,52</coordinates></Point>";
        let rahmen = |n: usize| {
            kml(&placemark(&format!(
                "{}{punkt}{}",
                "<MultiGeometry>".repeat(n - 1),
                "</MultiGeometry>".repeat(n - 1)
            )))
        };
        let n = lies(&rahmen(GEOMETRIE_TIEFE_MAX)).unwrap();
        assert_eq!(
            features(&n)[0]["geometry"],
            json!({"type":"Point","coordinates":[9.0,52.0]})
        );
        assert_eq!(
            lies(&rahmen(GEOMETRIE_TIEFE_MAX + 1)),
            Err(FremdebeneFehler::Unlesbar)
        );
    }

    #[test]
    fn kml_grenzen_wie_geojson() {
        let punkt = placemark("<Point><coordinates>9,52</coordinates></Point>");
        assert!(lies(&kml(&punkt.repeat(OBJEKTE_MAX))).is_ok());
        assert_eq!(
            lies(&kml(&punkt.repeat(OBJEKTE_MAX + 1))),
            Err(FremdebeneFehler::ZuVieleObjekte)
        );
        let linie = |n: usize| {
            let p: Vec<String> = (0..n)
                .map(|i| format!("{},52", 9.0 + i as f64 * 1e-5))
                .collect();
            placemark(&format!(
                "<LineString><coordinates>{}</coordinates></LineString>",
                p.join(" ")
            ))
        };
        assert!(lies(&kml(&linie(STUETZPUNKTE_JE_LINIE_MAX))).is_ok());
        assert_eq!(
            lies(&kml(&linie(STUETZPUNKTE_JE_LINIE_MAX + 1))),
            Err(FremdebeneFehler::ZuVieleObjekte)
        );
        assert_eq!(
            lies(&kml(&placemark(
                "<Point><coordinates>1113194.9,6800125.4</coordinates></Point>"
            ))),
            Err(FremdebeneFehler::Koordinaten)
        );
        assert_eq!(lies("<kml/>"), Err(FremdebeneFehler::Leer));
        assert_eq!(
            lies("<html><body>Fehler</body></html>"),
            Err(FremdebeneFehler::Unlesbar)
        );
        assert_eq!(
            lies("<kml><Placemark></kml>"),
            Err(FremdebeneFehler::Unlesbar)
        );
        assert_eq!(lies("<kml><Placemark>"), Err(FremdebeneFehler::Unlesbar));
    }
}
