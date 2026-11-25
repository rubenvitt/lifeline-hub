//! Die Drohnenlage als Fachebene (LLH-2106): ein GeoJSON-Umschlag wie jede andere Ebene der
//! Lagekarte, gebaut aus dem Stand im Arbeitsspeicher. Eigenschaft `kind` je Feature:
//! `aircraft` | `track` | `element` | `photo`. Keine Seriennummer, nur eigene Kennungen.

use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{json, Value};

use super::vertrag::DrohnenLage;
use crate::karte::typen::FachebeneAntwort;

/// Kennung der Ebene im Umschlag.
pub const QUELLE: &str = "drohne";
const ATTRIBUTION: &str = "Drohnenbild";

fn rfc3339(ms: i64) -> Option<String> {
    DateTime::<Utc>::from_timestamp_millis(ms).map(|t| t.to_rfc3339_opts(SecondsFormat::Secs, true))
}

/// Die Ebene zur Lage. Fotos erscheinen erst ab `fotos_ab_ms` (Zuschaltung des Einsatzes):
/// was die Drohne vorher aufgenommen hat, gehört nicht in diesen Einsatz. `abgerufen` ist der
/// Abrufzeitpunkt der Lage, nicht die Zeit des Aufrufs: gleicher Stand, gleiche Antwort.
pub fn build_fachebene(lage: &DrohnenLage, fotos_ab_ms: i64) -> FachebeneAntwort {
    let mut features: Vec<Value> = Vec::new();

    for g in &lage.fluggeraete {
        let Some([lon, lat]) = g.position else {
            continue;
        };
        features.push(json!({
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [lon, lat] },
            "properties": {
                "kind": "aircraft",
                "key": g.key,
                "label": g.label,
                "heading_deg": g.heading_deg,
                "airborne": g.airborne,
                "battery_percent": g.battery_percent,
            },
        }));
    }

    if let Some(liste) = lage
        .karte
        .as_ref()
        .and_then(|k| k.get("features"))
        .and_then(Value::as_array)
    {
        features.extend(
            liste
                .iter()
                .filter(|f| {
                    matches!(
                        f.pointer("/properties/kind").and_then(Value::as_str),
                        Some("track" | "element")
                    )
                })
                .cloned(),
        );
    }

    for f in lage.fotos.iter().filter(|f| f.taken_at_ms >= fotos_ab_ms) {
        features.push(json!({
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": f.position },
            "properties": {
                "kind": "photo",
                "key": f.key,
                "taken_at_ms": f.taken_at_ms,
                "lens": f.lens,
                "heading_deg": f.heading_deg,
            },
        }));
    }

    let mut antwort = FachebeneAntwort::ok(
        QUELLE,
        ATTRIBUTION,
        rfc3339(lage.quelle_stand_ms),
        json!({ "type": "FeatureCollection", "features": features }),
    );
    antwort.abgerufen = rfc3339(lage.stand_ms);
    antwort
}

/// Ebene ohne Stand: keine Zuschaltung, noch kein Abruf oder der Einsatz läuft nicht mehr.
pub fn offline() -> FachebeneAntwort {
    FachebeneAntwort::offline(QUELLE, ATTRIBUTION)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drohne::vertrag::{DrohnenFoto, Fluggeraet};
    use crate::karte::typen::FachebeneStatus;

    fn lage() -> DrohnenLage {
        DrohnenLage {
            stand_ms: 1_800_000_000_000,
            quelle_stand_ms: 1_799_999_990_000,
            mission_name: None,
            fluggeraete: vec![],
            karte: None,
            videos: vec![],
            fotos: vec![],
            verworfen: 0,
        }
    }

    fn foto(key: &str, ms: i64) -> DrohnenFoto {
        DrohnenFoto {
            key: key.into(),
            taken_at_ms: ms,
            position: [8.1, 49.2],
            lens: "wide".into(),
            heading_deg: Some(90.0),
            relative_altitude_m: None,
        }
    }

    fn kinds(a: &FachebeneAntwort) -> Vec<String> {
        a.features["features"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["properties"]["kind"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn fotos_vor_dem_zuschalten_fehlen() {
        let mut l = lage();
        l.fotos = vec![foto("alt", 999), foto("neu", 1000), foto("neuer", 2000)];
        let a = build_fachebene(&l, 1000);
        assert_eq!(kinds(&a), ["photo", "photo"]);
        let keys: Vec<&str> = a.features["features"]
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["properties"]["key"].as_str().unwrap())
            .collect();
        assert_eq!(keys, ["neu", "neuer"]);
    }

    #[test]
    fn fluggerät_trägt_blickrichtung() {
        let mut l = lage();
        l.fluggeraete = vec![Fluggeraet {
            key: "k1".into(),
            label: "Drohne 1".into(),
            position: Some([8.0, 49.0]),
            heading_deg: Some(135.0),
            height_m: Some(40.0),
            battery_percent: Some(77),
            airborne: true,
        }];
        let a = build_fachebene(&l, 0);
        let p = &a.features["features"][0]["properties"];
        assert_eq!(p["kind"], "aircraft");
        assert_eq!(p["label"], "Drohne 1");
        assert_eq!(p["heading_deg"], 135.0);
        assert_eq!(p["airborne"], true);
        assert_eq!(p["battery_percent"], 77);
        assert_eq!(
            a.features["features"][0]["geometry"]["coordinates"],
            json!([8.0, 49.0])
        );
    }

    #[test]
    fn spuren_und_elemente_kommen_aus_der_karte() {
        let mut l = lage();
        l.karte = Some(json!({"type": "FeatureCollection", "features": [
            {"type": "Feature", "geometry": null, "properties": {"kind": "track"}},
            {"type": "Feature", "geometry": null, "properties": {"kind": "element"}},
            {"type": "Feature", "geometry": null, "properties": {"kind": "unbekannt"}},
        ]}));
        let a = build_fachebene(&l, 0);
        assert_eq!(kinds(&a), ["track", "element"]);
        assert_eq!(a.status, FachebeneStatus::Ok);
    }

    #[test]
    fn ohne_features_ist_leer() {
        let a = build_fachebene(&lage(), 0);
        assert_eq!(a.status, FachebeneStatus::Leer);
        assert_eq!(a.abgerufen.as_deref(), Some("2027-01-15T08:00:00Z"));
    }
}
