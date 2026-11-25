//! GeoJSON lesen (RFC 7946): `FeatureCollection`, `Feature` oder eine nackte Geometrie. `crs`
//! wird übergangen (RFC 7946: WGS84); wer Meter liefert, scheitert an der Bereichsprüfung.

use super::{build_feature, finish, normalize_geometrie, Grenzen, Normiert};
use crate::karte_fremdebene::FremdebeneFehler;
use serde_json::Value;

const GEOMETRIE_TYPEN: &[&str] = &[
    "Point",
    "MultiPoint",
    "LineString",
    "MultiLineString",
    "Polygon",
    "MultiPolygon",
    "GeometryCollection",
];

pub fn read_geojson(text: &str, grenzen: &mut Grenzen) -> Result<Normiert, FremdebeneFehler> {
    let wurzel: Value = serde_json::from_str(text).map_err(|_| FremdebeneFehler::Unlesbar)?;
    let typ = wurzel.get("type").and_then(Value::as_str);
    let mut features = Vec::new();
    let mut verworfen = 0i64;
    let mut namensvorschlag = None;
    match typ {
        Some("FeatureCollection") => {
            let liste = wurzel
                .get("features")
                .and_then(Value::as_array)
                .ok_or(FremdebeneFehler::Unlesbar)?;
            namensvorschlag = wurzel.get("name").and_then(Value::as_str);
            for f in liste {
                grenzen.count_objekt()?;
                match feature(f, grenzen)? {
                    Some(f) => features.push(f),
                    None => verworfen += 1,
                }
            }
        }
        Some("Feature") => {
            grenzen.count_objekt()?;
            match feature(&wurzel, grenzen)? {
                Some(f) => features.push(f),
                None => verworfen += 1,
            }
        }
        Some(t) if GEOMETRIE_TYPEN.contains(&t) => {
            grenzen.count_objekt()?;
            match normalize_geometrie(&wurzel, grenzen)? {
                Some(g) => features.push(build_feature(g, None, None)),
                None => verworfen += 1,
            }
        }
        _ => return Err(FremdebeneFehler::Unlesbar),
    }
    finish(features, verworfen, namensvorschlag)
}

/// Ein Objekt; `Ok(None)`, wenn es keines ist oder keine lesbare Geometrie hat.
fn feature(f: &Value, grenzen: &mut Grenzen) -> Result<Option<Value>, FremdebeneFehler> {
    if f.get("type").and_then(Value::as_str) != Some("Feature") {
        return Ok(None);
    }
    let Some(geometrie) = f.get("geometry").filter(|g| !g.is_null()) else {
        return Ok(None);
    };
    let Some(geometrie) = normalize_geometrie(geometrie, grenzen)? else {
        return Ok(None);
    };
    let text = |schluessel: &str| {
        f.get("properties")
            .and_then(|p| p.get(schluessel))
            .and_then(Value::as_str)
    };
    Ok(Some(build_feature(
        geometrie,
        text("name"),
        text("description"),
    )))
}
