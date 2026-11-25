//! Geometrie prüfen und normieren: der eine Ort der Bereichsprüfung für Fremdebenen (Entwurf,
//! „Koordinaten“; neben `lage_zone::pruefe_geometrie_struktur`, die Zonen mit 400 ablehnt).
//!
//! Zwei Arten von Mangel: Was außerhalb der Erde liegt oder eine Grenze sprengt, lehnt die ganze
//! Datei ab (`Err`) — eine Datei in Web-Mercator-Metern soll den WGS84-Hinweis bekommen, nicht
//! still leer bleiben. Was nur kaputt gebaut ist (zu wenige Punkte, falscher Typ, unbekannte
//! Geometrie), verwirft das eine Objekt (`Ok(None)`); der Aufrufer zählt es.

use super::Grenzen;
use crate::karte_fremdebene::{FremdebeneFehler, NACHKOMMASTELLEN};
use serde_json::{json, Value};

/// Bereichsprüfung einer Position: endlich, Länge in [-180, 180], Breite in [-90, 90]. Liefert
/// sie gerundet auf [`NACHKOMMASTELLEN`].
pub fn check_bereich(lon: f64, lat: f64) -> Result<[f64; 2], FremdebeneFehler> {
    if !lon.is_finite() || !lat.is_finite() || !(-180.0..=180.0).contains(&lon) {
        return Err(FremdebeneFehler::Koordinaten);
    }
    if !(-90.0..=90.0).contains(&lat) {
        return Err(FremdebeneFehler::Koordinaten);
    }
    Ok([runde(lon), runde(lat)])
}

fn runde(x: f64) -> f64 {
    let faktor = 10f64.powi(NACHKOMMASTELLEN);
    let r = (x * faktor).round() / faktor;
    // -0.0 schreibt serde_json als `-0.0`.
    if r == 0.0 {
        0.0
    } else {
        r
    }
}

/// Ergebnis für ein einzelnes Teil: `Ok(None)` heißt kaputt gebaut.
type Teil<T> = Result<Option<T>, FremdebeneFehler>;

/// Eine Position `[lon, lat, …]`; die Höhe und weitere Werte fallen weg.
fn position(v: &Value) -> Teil<[f64; 2]> {
    let Some(a) = v.as_array() else {
        return Ok(None);
    };
    let (Some(lon), Some(lat)) = (
        a.first().and_then(Value::as_f64),
        a.get(1).and_then(Value::as_f64),
    ) else {
        return Ok(None);
    };
    check_bereich(lon, lat).map(Some)
}

/// Eine Folge von Positionen; eine kaputte Position macht die ganze Folge kaputt.
fn positionen(v: &Value, grenzen: &mut Grenzen) -> Teil<Vec<[f64; 2]>> {
    let Some(a) = v.as_array() else {
        return Ok(None);
    };
    grenzen.count_stuetzpunkte(a.len())?;
    let mut aus = Vec::with_capacity(a.len());
    for p in a {
        match position(p)? {
            Some(p) => aus.push(p),
            None => return Ok(None),
        }
    }
    Ok(Some(aus))
}

fn linie(v: &Value, grenzen: &mut Grenzen) -> Teil<Vec<[f64; 2]>> {
    Ok(positionen(v, grenzen)?.filter(|p| p.len() >= 2))
}

/// Ein Ring: wird geschlossen, wenn er offen ist, und hat dann mindestens 4 Punkte.
fn ring(v: &Value, grenzen: &mut Grenzen) -> Teil<Vec<[f64; 2]>> {
    let Some(mut p) = positionen(v, grenzen)? else {
        return Ok(None);
    };
    if let (Some(&erster), Some(&letzter)) = (p.first(), p.last()) {
        if erster != letzter {
            p.push(erster);
        }
    }
    Ok((p.len() >= 4).then_some(p))
}

/// Ein Polygon: ein kaputter Ring (außen oder Loch) macht das Polygon kaputt.
fn polygon(v: &Value, grenzen: &mut Grenzen) -> Teil<Vec<Vec<[f64; 2]>>> {
    let Some(ringe) = v.as_array().filter(|r| !r.is_empty()) else {
        return Ok(None);
    };
    let mut aus = Vec::with_capacity(ringe.len());
    for r in ringe {
        match ring(r, grenzen)? {
            Some(r) => aus.push(r),
            None => return Ok(None),
        }
    }
    Ok(Some(aus))
}

/// Eine Multi-Geometrie: kaputte Teile fallen weg, ohne Teile ist sie kaputt.
fn mehrere<T>(
    v: &Value,
    grenzen: &mut Grenzen,
    teil: fn(&Value, &mut Grenzen) -> Teil<T>,
) -> Teil<Vec<T>> {
    let Some(a) = v.as_array() else {
        return Ok(None);
    };
    let mut aus = Vec::with_capacity(a.len());
    for t in a {
        if let Some(t) = teil(t, grenzen)? {
            aus.push(t);
        }
    }
    Ok((!aus.is_empty()).then_some(aus))
}

/// Normiert eine GeoJSON-Geometrie: Höhe weg, gerundet, Ringe geschlossen, eine
/// `GeometryCollection` flachgeklopft (ein Teil allein steht für sich). `Ok(None)` heißt: das
/// Objekt hat keine lesbare Geometrie und wird verworfen.
pub fn normalize_geometrie(
    v: &Value,
    zaehler: &mut Grenzen,
) -> Result<Option<Value>, FremdebeneFehler> {
    let Some(typ) = v.get("type").and_then(Value::as_str) else {
        return Ok(None);
    };
    if typ == "GeometryCollection" {
        let Some(teile) = v.get("geometries").and_then(Value::as_array) else {
            return Ok(None);
        };
        let mut flach = Vec::new();
        for t in teile {
            match normalize_geometrie(t, zaehler)? {
                Some(g) if g["type"] == "GeometryCollection" => {
                    if let Some(Value::Array(innen)) = g.get("geometries") {
                        flach.extend(innen.iter().cloned());
                    }
                }
                Some(g) => flach.push(g),
                None => {}
            }
        }
        return Ok(match flach.len() {
            0 => None,
            1 => flach.pop(),
            _ => Some(json!({ "type": "GeometryCollection", "geometries": flach })),
        });
    }
    let Some(c) = v.get("coordinates") else {
        return Ok(None);
    };
    let koordinaten = match typ {
        "Point" => {
            zaehler.count_stuetzpunkte(1)?;
            position(c)?.map(|p| json!(p))
        }
        "MultiPoint" => mehrere(c, zaehler, |p, g| {
            g.count_stuetzpunkte(1)?;
            position(p)
        })?
        .map(|p| json!(p)),
        "LineString" => linie(c, zaehler)?.map(|p| json!(p)),
        "MultiLineString" => mehrere(c, zaehler, linie)?.map(|p| json!(p)),
        "Polygon" => polygon(c, zaehler)?.map(|p| json!(p)),
        "MultiPolygon" => mehrere(c, zaehler, polygon)?.map(|p| json!(p)),
        _ => None,
    };
    Ok(koordinaten.map(|k| json!({ "type": typ, "coordinates": k })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bereich_und_rundung() {
        assert_eq!(check_bereich(180.0, -90.0), Ok([180.0, -90.0]));
        assert_eq!(check_bereich(-0.0000001, 0.0), Ok([0.0, 0.0]));
        assert_eq!(
            check_bereich(180.000001, 0.0),
            Err(FremdebeneFehler::Koordinaten)
        );
        assert_eq!(check_bereich(0.0, 90.5), Err(FremdebeneFehler::Koordinaten));
        assert_eq!(
            check_bereich(f64::NAN, 0.0),
            Err(FremdebeneFehler::Koordinaten)
        );
    }

    #[test]
    fn multi_geometrien_verlieren_nur_kaputte_teile() {
        let mut g = Grenzen::default();
        let v = json!({"type":"MultiLineString","coordinates":[[[9,52]],[[9,52],[9.1,52.1]]]});
        assert_eq!(
            normalize_geometrie(&v, &mut g).unwrap(),
            Some(json!({"type":"MultiLineString","coordinates":[[[9.0,52.0],[9.1,52.1]]]}))
        );
        let v = json!({"type":"MultiPolygon","coordinates":[[[[9,52],[9.1,52]]]]});
        assert_eq!(normalize_geometrie(&v, &mut g).unwrap(), None);
        let v = json!({"type":"MultiPoint","coordinates":[[9,52],"x"]});
        assert_eq!(
            normalize_geometrie(&v, &mut g).unwrap(),
            Some(json!({"type":"MultiPoint","coordinates":[[9.0,52.0]]}))
        );
    }
}
