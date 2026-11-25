//! Reine Übersetzung der Suchlage-Schnittstelle „lagemonitor v1“ in den neutralen Vertrag.
//! Eigene, tolerante Lesetypen (unbekannte Felder werden ignoriert); keine Abhängigkeit auf Suchlage.
//! Seriennummern und Vorschau-Pfade landen nur in [`Upstream`], nie im Vertrag.

use std::collections::HashMap;

use serde::Deserialize;

use super::is_safe_segment;
use super::vertrag::{key_for, DrohnenFoto, DrohnenLage, DrohnenVideo, Fluggeraet};

/// Was nur wir kennen: Kennung → Seriennummer bzw. Vorschau-Pfad. Verlässt den Speicher nie.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Upstream {
    pub videos: HashMap<String, String>,
    pub fotos: HashMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    VersionUnbekannt(u32),
    Ungueltig,
}

type LageErgebnis = (DrohnenLage, Option<String>, Option<i64>, Upstream);

const API_VERSION: u32 = 1;

#[derive(Deserialize)]
struct Version {
    api_version: u32,
}

#[derive(Deserialize)]
struct LmLage {
    server_time_ms: i64,
    mission: Option<LmMission>,
    map: Option<serde_json::Value>,
    map_etag: Option<String>,
    #[serde(default)]
    aircraft: Vec<LmAircraft>,
    #[serde(default)]
    videos: Vec<LmVideo>,
    photos_latest_ms: Option<i64>,
}

#[derive(Deserialize)]
struct LmMission {
    name: String,
}

#[derive(Deserialize)]
struct LmPoint {
    lat: f64,
    lon: f64,
}

#[derive(Deserialize)]
struct LmAircraft {
    gateway_sn: String,
    label: Option<String>,
    position: Option<LmPoint>,
    heading_deg: Option<f64>,
    elevation_takeoff_m: Option<f64>,
    battery_percent: Option<u8>,
    #[serde(default)]
    airborne: bool,
}

#[derive(Deserialize)]
struct LmVideo {
    gateway_sn: String,
}

#[derive(Deserialize)]
struct LmPhotoShot {
    id: i64,
    taken_at_ms: i64,
    position: Option<LmPoint>,
    relative_altitude_m: Option<f64>,
    gimbal_yaw_deg: Option<f64>,
    #[serde(default)]
    photos: Vec<LmPhoto>,
}

#[derive(Deserialize)]
struct LmPhoto {
    lens: String,
    thumb_url: String,
}

/// Übersetzt `GET /lage`. `vorige_karte` (Fassung und Karte des letzten Abrufs) gilt, wenn die
/// Antwort die Karte weglässt, weil sie unverändert ist.
pub fn parse_lage(
    adapter_id: &str,
    json: &[u8],
    vorige_karte: Option<(&str, &serde_json::Value)>,
    jetzt_ms: i64,
) -> Result<LageErgebnis, ParseError> {
    let Version { api_version } =
        serde_json::from_slice(json).map_err(|_| ParseError::Ungueltig)?;
    if api_version != API_VERSION {
        return Err(ParseError::VersionUnbekannt(api_version));
    }
    let lm: LmLage = serde_json::from_slice(json).map_err(|_| ParseError::Ungueltig)?;

    let mut upstream = Upstream::default();
    // Eine Seriennummer wandert in den Abruf-Pfad: nur ein sicheres Segment ist zulässig, sonst
    // fällt das Fluggerät samt Video weg.
    let mut verworfen = 0;
    let fluggeraete = lm
        .aircraft
        .into_iter()
        .enumerate()
        .filter_map(|(i, a)| {
            if !is_safe_segment(&a.gateway_sn) {
                verworfen += 1;
                return None;
            }
            Some(Fluggeraet {
                key: key_for(adapter_id, &a.gateway_sn),
                label: a
                    .label
                    .filter(|l| !l.trim().is_empty())
                    .unwrap_or_else(|| format!("Fluggerät {}", i + 1)),
                position: a.position.map(|p| [p.lon, p.lat]),
                heading_deg: a.heading_deg,
                height_m: a.elevation_takeoff_m,
                battery_percent: a.battery_percent,
                airborne: a.airborne,
            })
        })
        .collect();
    let videos = lm
        .videos
        .into_iter()
        .filter_map(|v| {
            if !is_safe_segment(&v.gateway_sn) {
                verworfen += 1;
                return None;
            }
            let key = key_for(adapter_id, &v.gateway_sn);
            upstream.videos.insert(key.clone(), v.gateway_sn);
            Some(DrohnenVideo { key })
        })
        .collect();

    let (karte, map_etag) = match lm.map {
        Some(map) => (Some(karte_umschreiben(&map, &mut verworfen)), lm.map_etag),
        None => match vorige_karte {
            Some((etag, karte)) => (Some(karte.clone()), Some(etag.to_owned())),
            None => (None, lm.map_etag),
        },
    };

    let lage = DrohnenLage {
        stand_ms: jetzt_ms,
        quelle_stand_ms: lm.server_time_ms,
        mission_name: lm.mission.map(|m| m.name),
        fluggeraete,
        karte,
        videos,
        fotos: Vec::new(),
        verworfen,
    };
    Ok((lage, map_etag, lm.photos_latest_ms, upstream))
}

/// Schreibt die Features nach `kind` `track` bzw. `element` um; alles andere wird verworfen
/// und gezählt.
fn karte_umschreiben(map: &serde_json::Value, verworfen: &mut u32) -> serde_json::Value {
    let mut features = Vec::new();
    let eingang = map
        .get("features")
        .and_then(|f| f.as_array())
        .map_or(&[][..], Vec::as_slice);
    for feature in eingang {
        let props = feature.get("properties");
        let text = |k: &str| props.and_then(|p| p.get(k)).cloned();
        let neu = match props.and_then(|p| p.get("kind")).and_then(|k| k.as_str()) {
            Some("flight_track") => Some((
                "track",
                serde_json::json!({
                    "kind": "track",
                    "label": text("name"),
                    "color": text("color"),
                    "started_at_ms": text("started_at_ms"),
                    "ended_at_ms": text("ended_at_ms"),
                }),
            )),
            Some("map_element") => Some((
                "element",
                serde_json::json!({
                    "kind": "element",
                    "label": text("name"),
                    "color": text("color"),
                }),
            )),
            _ => None,
        };
        match (neu, feature.get("geometry")) {
            (Some((_, properties)), Some(geometry)) => features.push(serde_json::json!({
                "type": "Feature",
                "geometry": geometry,
                "properties": properties,
            })),
            _ => *verworfen += 1,
        }
    }
    serde_json::json!({ "type": "FeatureCollection", "features": features })
}

/// Ob `pfad` genau ein Vorschau-Pfad der Quelle ist: `/api/lagemonitor/v1/photos/{Ziffern}/thumb`,
/// optional mit `?v={[A-Za-z0-9._-]+}`. Alles andere (`..`, `//`, `#`, weitere Parameter,
/// absolute Adressen) ist keiner: der Pfad kommt aus der Antwort der Quelle und wird an die
/// Basisadresse gehängt.
pub fn is_thumb_pfad(pfad: &str) -> bool {
    let Some(rest) = pfad.strip_prefix("/api/lagemonitor/v1/photos/") else {
        return false;
    };
    let Some((id, tail)) = rest.split_once('/') else {
        return false;
    };
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    match tail.strip_prefix("thumb") {
        Some("") => true,
        Some(query) => query.strip_prefix("?v=").is_some_and(|v| {
            !v.is_empty()
                && !v.contains("..")
                && v.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        }),
        None => false,
    }
}

/// Ergebnis von [`parse_photos`]: Fotos, Kennung → Vorschau-Pfad (bleibt im Speicher) und die
/// Zahl der Vorschauen mit unzulässigem Pfad, die samt Foto weggelassen wurden.
pub type FotosErgebnis = (Vec<DrohnenFoto>, HashMap<String, String>, u32);

/// Übersetzt `GET /photos`: je Linse ein Foto, Schlüssel `"{id}:{lens}"`. Auslösungen ohne
/// Position fallen weg, ebenso Linsen, deren Vorschau-Pfad [`is_thumb_pfad`] nicht erfüllt.
pub fn parse_photos(adapter_id: &str, json: &[u8]) -> Result<FotosErgebnis, ParseError> {
    let shots: Vec<LmPhotoShot> =
        serde_json::from_slice(json).map_err(|_| ParseError::Ungueltig)?;
    let mut fotos = Vec::new();
    let mut thumbs = HashMap::new();
    let mut verworfen = 0;
    for shot in shots {
        let Some(p) = shot.position else { continue };
        for photo in shot.photos {
            if !is_thumb_pfad(&photo.thumb_url) {
                verworfen += 1;
                continue;
            }
            let key = key_for(adapter_id, &format!("{}:{}", shot.id, photo.lens));
            thumbs.insert(key.clone(), photo.thumb_url);
            fotos.push(DrohnenFoto {
                key,
                taken_at_ms: shot.taken_at_ms,
                position: [p.lon, p.lat],
                lens: photo.lens,
                heading_deg: shot.gimbal_yaw_deg,
                relative_altitude_m: shot.relative_altitude_m,
            });
        }
    }
    Ok((fotos, thumbs, verworfen))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drohne::vertrag::key_for;

    const LAGE: &[u8] = include_bytes!("testdaten/lage.json");
    const OHNE_KARTE: &[u8] = include_bytes!("testdaten/lage_ohne_karte.json");
    const PHOTOS: &[u8] = include_bytes!("testdaten/photos.json");

    #[test]
    fn übersetzt_fluggerät_ohne_seriennummer() {
        let (lage, etag, latest, up) = parse_lage("a1", LAGE, None, 99).unwrap();
        assert_eq!(lage.stand_ms, 99);
        assert_eq!(lage.quelle_stand_ms, 1_700_000_005_000);
        assert_eq!(lage.mission_name.as_deref(), Some("Übung Waldsuche"));
        assert_eq!(etag.as_deref(), Some("abcd1234abcd1234"));
        assert_eq!(latest, Some(1_700_000_004_000));
        assert_eq!(lage.fluggeraete.len(), 2);
        let g = &lage.fluggeraete[0];
        assert_eq!(g.key, key_for("a1", "RC-TEST-1"));
        assert_eq!(g.label, "Drohne Alpha");
        assert_eq!(g.position, Some([8.2, 50.2]));
        assert_eq!(g.height_m, Some(42.5));
        assert_eq!(g.battery_percent, Some(77));
        assert!(g.airborne);
        assert!(!lage.fluggeraete[1].label.is_empty());
        assert_eq!(lage.videos.len(), 1);
        assert_eq!(lage.videos[0].key, g.key);
        assert_eq!(up.videos[&g.key], "RC-TEST-1");
        let json = serde_json::to_string(&lage).unwrap();
        assert!(!json.contains("RC-TEST"), "Seriennummer im Vertrag: {json}");
    }

    #[test]
    fn kennung_ist_stabil_und_je_adapter_verschieden() {
        let k = key_for("a1", "RC-TEST-1");
        assert_eq!(k.len(), 16);
        assert!(k.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(k, key_for("a1", "RC-TEST-1"));
        assert_ne!(k, key_for("a2", "RC-TEST-1"));
        assert_ne!(k, key_for("a1", "RC-TEST-2"));
    }

    #[test]
    fn karte_wird_in_spur_und_element_umgeschrieben() {
        let (lage, ..) = parse_lage("a1", LAGE, None, 0).unwrap();
        let karte = lage.karte.unwrap();
        let features = karte["features"].as_array().unwrap();
        assert_eq!(features.len(), 2);
        assert_eq!(features[0]["properties"]["kind"], "track");
        assert_eq!(features[0]["properties"]["label"], "Flug 1");
        assert_eq!(features[0]["geometry"]["type"], "MultiLineString");
        assert_eq!(features[1]["properties"]["kind"], "element");
        assert_eq!(features[1]["properties"]["label"], "Suchgebiet Nord");
        assert_eq!(features[1]["properties"]["color"], "#00ff00");
    }

    #[test]
    fn fehlende_karte_übernimmt_die_vorige() {
        let vorige = serde_json::json!({"type": "FeatureCollection", "features": []});
        let (lage, etag, ..) =
            parse_lage("a1", OHNE_KARTE, Some(("abcd1234abcd1234", &vorige)), 1).unwrap();
        assert_eq!(lage.karte, Some(vorige));
        assert_eq!(etag.as_deref(), Some("abcd1234abcd1234"));
        let (lage, ..) = parse_lage("a1", OHNE_KARTE, None, 1).unwrap();
        assert_eq!(lage.karte, None);
    }

    #[test]
    fn unbekannte_version_wird_abgelehnt() {
        let json = br#"{"api_version": 2, "server_time_ms": 1, "aircraft": [], "videos": []}"#;
        assert_eq!(
            parse_lage("a1", json, None, 0).unwrap_err(),
            ParseError::VersionUnbekannt(2)
        );
        assert_eq!(
            parse_lage("a1", b"kein json", None, 0).unwrap_err(),
            ParseError::Ungueltig
        );
    }

    #[test]
    fn unbekannte_feature_arten_werden_gezählt() {
        let (lage, ..) = parse_lage("a1", LAGE, None, 0).unwrap();
        assert_eq!(lage.verworfen, 1);
        let karte = lage.karte.unwrap();
        assert!(!karte.to_string().contains("etwas_neues"));
    }

    #[test]
    fn feindliche_seriennummer_wird_samt_video_verworfen() {
        let json = br#"{"api_version": 1, "server_time_ms": 1,
            "aircraft": [
              {"gateway_sn": "../../../admin", "label": "boese"},
              {"gateway_sn": "RC?x#y", "label": "boese 2"},
              {"gateway_sn": "RC-OK-1", "label": "gut"}],
            "videos": [{"gateway_sn": "../../../admin"}, {"gateway_sn": "RC-OK-1"}]}"#;
        let (lage, _, _, up) = parse_lage("a1", json, None, 0).unwrap();
        assert_eq!(lage.fluggeraete.len(), 1);
        assert_eq!(lage.fluggeraete[0].label, "gut");
        assert_eq!(lage.videos.len(), 1);
        assert_eq!(up.videos.len(), 1);
        assert_eq!(up.videos[&lage.videos[0].key], "RC-OK-1");
        assert_eq!(lage.verworfen, 3, "zwei Fluggeräte, ein Video");
    }

    #[test]
    fn fotos_ohne_position_fallen_weg() {
        let (fotos, ..) = parse_photos("a1", PHOTOS).unwrap();
        assert_eq!(fotos.len(), 2, "zwei Linsen der Auslösung 17, keine von 20");
        assert!(fotos.iter().all(|f| f.taken_at_ms == 1_700_000_003_000));
        assert_eq!(fotos[0].lens, "thermal");
        assert_eq!(fotos[0].position, [8.1, 50.1]);
        assert_eq!(fotos[0].heading_deg, Some(180.0));
        assert_eq!(fotos[0].relative_altitude_m, Some(55.0));
    }

    #[test]
    fn foto_kennung_bildet_auf_thumb_url_ab() {
        let (fotos, up, _) = parse_photos("a1", PHOTOS).unwrap();
        let k = key_for("a1", "17:thermal");
        assert_eq!(fotos[0].key, k);
        assert_eq!(up[&k], "/api/lagemonitor/v1/photos/17/thumb?v=1");
        assert_eq!(up.len(), 2);
        assert!(!serde_json::to_string(&fotos).unwrap().contains("/photos/"));
    }

    #[test]
    fn thumb_pfad_nur_in_der_erwarteten_form() {
        for ok in [
            "/api/lagemonitor/v1/photos/17/thumb",
            "/api/lagemonitor/v1/photos/0/thumb?v=1",
            "/api/lagemonitor/v1/photos/17/thumb?v=a.b_c-D9",
        ] {
            assert!(is_thumb_pfad(ok), "{ok}");
        }
        for schlecht in [
            "",
            "https://evil.example/api/lagemonitor/v1/photos/17/thumb",
            "//evil.example/api/lagemonitor/v1/photos/17/thumb",
            "api/lagemonitor/v1/photos/17/thumb",
            "/api/lagemonitor/v1/photos/../17/thumb",
            "/api/lagemonitor/v1/photos//thumb",
            "/api/lagemonitor/v1/photos/x/thumb",
            "/api/lagemonitor/v1/photos/17/thumb/",
            "/api/lagemonitor/v1/photos/17/thumbs",
            "/api/lagemonitor/v1/photos/17/thumb?",
            "/api/lagemonitor/v1/photos/17/thumb?v=",
            "/api/lagemonitor/v1/photos/17/thumb?v=1&x=2",
            "/api/lagemonitor/v1/photos/17/thumb?x=1",
            "/api/lagemonitor/v1/photos/17/thumb?v=..",
            "/api/lagemonitor/v1/photos/17/thumb?v=a/b",
            "/api/lagemonitor/v1/photos/17/thumb?v=1#x",
            "/api/lagemonitor/v1/photos/17/thumb#x",
            "/api/lagemonitor/v1/photos/17/thumb?v=a%2fb",
            "/api/lagemonitor/v1/photos/17/thumb\n",
            "/api/lagemonitor/v1/photos/17/thumb?v=1\n",
            "/api/lagemonitor/v1/photos/17/video",
            "/api/other/photos/17/thumb",
        ] {
            assert!(!is_thumb_pfad(schlecht), "{schlecht:?}");
        }
    }

    #[test]
    fn feindlicher_thumb_pfad_verwirft_das_foto_und_zaehlt() {
        let json = br#"[{"id": 1, "taken_at_ms": 5, "position": {"lat": 1.0, "lon": 2.0},
            "photos": [
              {"lens": "a", "thumb_url": "https://evil.example/x"},
              {"lens": "b", "thumb_url": "/api/lagemonitor/v1/photos/1/thumb?v=1&x=2"},
              {"lens": "c", "thumb_url": "/api/lagemonitor/v1/photos/1/thumb?v=1"}]}]"#;
        let (fotos, up, verworfen) = parse_photos("a1", json).unwrap();
        assert_eq!(fotos.len(), 1);
        assert_eq!(fotos[0].lens, "c");
        assert_eq!(up.len(), 1);
        assert_eq!(verworfen, 2);
    }
}
