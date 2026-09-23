//! Reine Auswertung der Bright-Sky-Antworten (LFH-633): `/alerts` → Warnzelle + Warnungen,
//! `/weather` → Vorhersage. Kein Netz, keine Uhr — die Zeit kommt als `jetzt` herein.
//!
//! **Lieber zu niedrig als verschwiegen:** eine Warnung mit unbekanntem `severity` bleibt
//! stehen (als `gering`, geloggt), ebenso eine mit unbekannter Kategorie. Bewusst gefiltert
//! wird genau eine Kategorie: `health` (Hitze, UV) ist kein Wetterereignis im Einsatzsinn.

use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::Value;

use super::{WetterOrt, WetterStunde, WetterVorhersage, WetterWarnstufe, WetterWarnung};

/// Die Warnkategorie, die nicht erscheint: Gesundheitswarnungen (Hitze, UV).
pub const KATEGORIE_GESUNDHEIT: &str = "health";

/// Zeitstempel der Quelle → RFC 3339 in UTC mit `Z`. `None`, wenn nicht lesbar.
fn utc(s: &str) -> Option<String> {
    DateTime::parse_from_rfc3339(s).ok().map(|t| {
        t.with_timezone(&Utc)
            .to_rfc3339_opts(SecondsFormat::Secs, true)
    })
}

fn zeit(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

/// Nicht-leerer, getrimmter Text eines Felds.
fn text(v: &Value, feld: &str) -> Option<String> {
    v.get(feld)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Endliche Zahl eines Felds; `null` oder fehlend → `None`, nie 0.
fn zahl(v: &Value, feld: &str) -> Option<f64> {
    v.get(feld)
        .and_then(Value::as_f64)
        .filter(|x| x.is_finite())
}

/// `severity` → Stufe. Unbekannt → `gering` samt Warnung im Log: eine Warnung zu
/// verschweigen wäre schlimmer als eine zu niedrige Stufe neben ihrem Ereignistext.
pub fn stufe_aus_severity(severity: Option<&str>) -> WetterWarnstufe {
    match severity.map(str::to_ascii_lowercase).as_deref() {
        Some("minor") => WetterWarnstufe::Gering,
        Some("moderate") => WetterWarnstufe::Maessig,
        Some("severe") => WetterWarnstufe::Schwer,
        Some("extreme") => WetterWarnstufe::Extrem,
        andere => {
            tracing::warn!("Bright Sky: unbekannte Warnstufe {andere:?}, gezeigt als „gering“");
            WetterWarnstufe::Gering
        }
    }
}

fn warnung(a: &Value) -> Option<WetterWarnung> {
    match a.get("category").and_then(Value::as_str) {
        Some(KATEGORIE_GESUNDHEIT) => return None,
        Some("met") => {}
        andere => tracing::warn!("Bright Sky: unbekannte Warnkategorie {andere:?}, gezeigt"),
    }
    let ereignis = text(a, "event_de")
        .or_else(|| text(a, "event_en"))
        .unwrap_or_else(|| "Wetterwarnung".to_string());
    Some(WetterWarnung {
        stufe: stufe_aus_severity(a.get("severity").and_then(Value::as_str)),
        ueberschrift: text(a, "headline_de")
            .or_else(|| text(a, "headline_en"))
            .unwrap_or_else(|| ereignis.clone()),
        ereignis,
        beschreibung: text(a, "description_de"),
        handlungsempfehlung: text(a, "instruction_de"),
        beginn: text(a, "onset").and_then(|s| utc(&s)),
        ende: text(a, "expires").and_then(|s| utc(&s)),
        ausgegeben: text(a, "effective").and_then(|s| utc(&s)),
    })
}

/// `/alerts?lat&lon` → (Warnzelle, Warnungen ohne `health`). Noch ungefiltert nach Zeit —
/// das tut [`gueltige`] bei jeder Antwort, damit auch ein alter Stand keine abgelaufene
/// Warnung zeigt. `None`, wenn die Antwort keine Warnliste trägt.
pub fn parse_alerts(roh: &Value) -> Option<(Option<WetterOrt>, Vec<WetterWarnung>)> {
    let alerts = roh.get("alerts")?.as_array()?;
    let ort = roh.get("location").and_then(|l| {
        Some(WetterOrt {
            name: text(l, "name")?,
            kreis: text(l, "district"),
            land: text(l, "state"),
        })
    });
    Some((ort, alerts.iter().filter_map(warnung).collect()))
}

/// Entfernt Warnungen, deren Ende verstrichen ist (`ende ≤ jetzt`), und sortiert nach Stufe
/// absteigend, dann nach Beginn aufsteigend (ohne Beginn zuerst: sie gelten schon).
pub fn gueltige(warnungen: Vec<WetterWarnung>, jetzt: DateTime<Utc>) -> Vec<WetterWarnung> {
    let mut gueltig: Vec<WetterWarnung> = warnungen
        .into_iter()
        .filter(|w| {
            w.ende
                .as_deref()
                .and_then(zeit)
                .is_none_or(|ende| ende > jetzt)
        })
        .collect();
    gueltig.sort_by(|a, b| {
        b.stufe.cmp(&a.stufe).then_with(|| {
            a.beginn
                .as_deref()
                .and_then(zeit)
                .cmp(&b.beginn.as_deref().and_then(zeit))
        })
    });
    gueltig
}

fn stunde(w: &Value) -> Option<WetterStunde> {
    Some(WetterStunde {
        zeitpunkt: utc(w.get("timestamp")?.as_str()?)?,
        temperatur_c: zahl(w, "temperature"),
        niederschlag_mm: zahl(w, "precipitation"),
        niederschlag_wahrscheinlichkeit: zahl(w, "precipitation_probability"),
        wind_kmh: zahl(w, "wind_speed"),
        boeen_kmh: zahl(w, "wind_gust_speed"),
        windrichtung_grad: zahl(w, "wind_direction"),
    })
}

/// `/weather?lat&lon&date&last_date` → Vorhersage. Die Station ist die Quelle, deren `id` im
/// ersten Stundeneintrag als `source_id` steht (Rückfall: die erste Quelle). Stunden ohne
/// lesbaren Zeitstempel fallen weg, der Rest steht aufsteigend. `None`, wenn die Antwort
/// keine Stundenliste trägt.
pub fn parse_weather(roh: &Value) -> Option<WetterVorhersage> {
    let eintraege = roh.get("weather")?.as_array()?;
    let quellen: &[Value] = roh
        .get("sources")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let source_id = eintraege
        .first()
        .and_then(|w| w.get("source_id"))
        .and_then(Value::as_i64);
    let station = quellen
        .iter()
        .find(|q| source_id.is_some() && q.get("id").and_then(Value::as_i64) == source_id)
        .or_else(|| quellen.first());
    let mut stunden: Vec<WetterStunde> = eintraege.iter().filter_map(stunde).collect();
    stunden.sort_by_key(|s| zeit(&s.zeitpunkt));
    Some(WetterVorhersage {
        station: station.and_then(|q| text(q, "station_name")),
        entfernung_m: station.and_then(|q| zahl(q, "distance")),
        stunden,
    })
}

/// Lässt nur die Stunden ab der laufenden (vollen) Stunde stehen — auch ein Stand von vor
/// einigen Stunden zeigt damit keine vergangene Stunde als Vorhersage.
pub fn kommende_stunden(mut v: WetterVorhersage, jetzt: DateTime<Utc>) -> WetterVorhersage {
    let volle_stunde = jetzt.timestamp() - jetzt.timestamp().rem_euclid(3600);
    v.stunden
        .retain(|s| zeit(&s.zeitpunkt).is_some_and(|t| t.timestamp() >= volle_stunde));
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Mitgeschnitten am 23.09.2026 (`/alerts?lat=53.55&lon=8.58`, Bremerhaven): die zwei
    /// ersten Warnungen sind echt, dazu ergänzt je eine Warnung `severe`, `extreme` (ohne
    /// `expires`, ohne Beschreibung), mit unbekannter Stufe, der Kategorie `health` und eine
    /// abgelaufene.
    fn alerts() -> Value {
        serde_json::from_str(include_str!("testdaten/alerts.json")).unwrap()
    }

    /// Mitgeschnitten am 23.09.2026 (`/weather?lat=53.08&lon=8.80`, Bremen, 25 Stunden ab
    /// 12:00Z). Ergänzt: eine SYNOP-Quelle VOR der MOSMIX-Station (die Station kommt aus
    /// `source_id`, nicht aus der Reihenfolge) und `null` an einzelnen Werten der Stunden 2–4.
    fn weather() -> Value {
        serde_json::from_str(include_str!("testdaten/weather.json")).unwrap()
    }

    fn t(s: &str) -> DateTime<Utc> {
        zeit(s).unwrap()
    }

    fn ereignisse(w: &[WetterWarnung]) -> Vec<&str> {
        w.iter().map(|w| w.ereignis.as_str()).collect()
    }

    #[test]
    fn alle_vier_stufen_und_die_unbekannte() {
        assert_eq!(stufe_aus_severity(Some("minor")), WetterWarnstufe::Gering);
        assert_eq!(
            stufe_aus_severity(Some("moderate")),
            WetterWarnstufe::Maessig
        );
        assert_eq!(stufe_aus_severity(Some("severe")), WetterWarnstufe::Schwer);
        assert_eq!(stufe_aus_severity(Some("extreme")), WetterWarnstufe::Extrem);
        assert_eq!(stufe_aus_severity(Some("unknown")), WetterWarnstufe::Gering);
        assert_eq!(stufe_aus_severity(None), WetterWarnstufe::Gering);
    }

    #[test]
    fn alerts_mit_ort_ohne_health() {
        let (ort, warnungen) = parse_alerts(&alerts()).unwrap();
        assert_eq!(
            ort,
            Some(WetterOrt {
                name: "Stadt Bremerhaven".into(),
                kreis: Some("Bremerhaven".into()),
                land: Some("Bremen".into()),
            })
        );
        // Sieben Einträge, die `health`-Warnung fehlt; die abgelaufene ist noch da (sie fällt
        // erst in `gueltige`).
        assert_eq!(warnungen.len(), 6);
        assert!(!ereignisse(&warnungen).contains(&"STARKE HITZE"));
        let stufen: Vec<WetterWarnstufe> = warnungen.iter().map(|w| w.stufe).collect();
        assert_eq!(
            stufen,
            vec![
                WetterWarnstufe::Gering,
                WetterWarnstufe::Schwer,
                WetterWarnstufe::Maessig,
                WetterWarnstufe::Gering,
                WetterWarnstufe::Extrem,
                WetterWarnstufe::Gering, // `severity: "unknown"` bleibt stehen
            ]
        );
    }

    #[test]
    fn warnung_felder_in_utc_und_fehlendes_bleibt_none() {
        let (_, warnungen) = parse_alerts(&alerts()).unwrap();
        let sturm = warnungen
            .iter()
            .find(|w| w.ereignis == "STURMBÖEN")
            .unwrap();
        assert_eq!(sturm.stufe, WetterWarnstufe::Maessig);
        assert_eq!(sturm.ueberschrift, "Amtliche WARNUNG vor STURMBÖEN");
        assert_eq!(sturm.beginn.as_deref(), Some("2026-09-23T19:00:00Z"));
        assert_eq!(sturm.ende.as_deref(), Some("2026-09-24T11:00:00Z"));
        assert_eq!(sturm.ausgegeben.as_deref(), Some("2026-09-23T09:41:00Z"));
        assert!(sturm
            .beschreibung
            .as_deref()
            .unwrap()
            .starts_with("Es treten Sturmböen"));
        assert!(sturm
            .handlungsempfehlung
            .as_deref()
            .unwrap()
            .starts_with("Gefahr durch"));

        let orkan = warnungen
            .iter()
            .find(|w| w.ereignis == "ORKANBÖEN")
            .unwrap();
        assert_eq!(orkan.ende, None, "`expires: null` ist kein Ende");
        assert_eq!(orkan.beschreibung, None);
        assert_eq!(orkan.handlungsempfehlung, None);
    }

    #[test]
    fn versatz_wird_nach_utc_umgerechnet() {
        let roh = json!({ "alerts": [{
            "category": "met", "severity": "minor", "event_de": "FROST",
            "headline_de": "Amtliche WARNUNG vor FROST",
            "onset": "2026-09-24T02:00:00+02:00", "expires": "kaputt"
        }]});
        let (ort, w) = parse_alerts(&roh).unwrap();
        assert_eq!(ort, None, "ohne `location` keine Warnzelle");
        assert_eq!(w[0].beginn.as_deref(), Some("2026-09-24T00:00:00Z"));
        assert_eq!(
            w[0].ende, None,
            "unlesbares Ende: die Warnung bleibt stehen"
        );
    }

    #[test]
    fn unbekannte_kategorie_bleibt_stehen() {
        let roh = json!({ "alerts": [
            { "category": "geo", "severity": "moderate", "event_de": "X", "headline_de": "X" },
            { "severity": "moderate", "event_de": "Y", "headline_de": "Y" },
            { "category": "health", "severity": "extreme", "event_de": "Z", "headline_de": "Z" }
        ]});
        let (_, w) = parse_alerts(&roh).unwrap();
        assert_eq!(ereignisse(&w), vec!["X", "Y"]);
    }

    #[test]
    fn keine_warnliste_ist_keine_antwort() {
        assert!(parse_alerts(&json!({ "error": "x" })).is_none());
        assert_eq!(
            parse_alerts(&json!({ "alerts": [] })),
            Some((None, vec![])),
            "leere Liste ist eine gültige Antwort"
        );
    }

    #[test]
    fn gueltige_filtert_abgelaufene_und_sortiert() {
        let (_, warnungen) = parse_alerts(&alerts()).unwrap();
        // 23.09.2026 12:00Z: die Warnung bis 09:00Z ist abgelaufen.
        let g = gueltige(warnungen.clone(), t("2026-09-23T12:00:00Z"));
        assert_eq!(
            ereignisse(&g),
            vec![
                "ORKANBÖEN",        // extrem
                "ORKANARTIGE BÖEN", // schwer
                "STURMBÖEN",        // mäßig
                "FROST",            // gering, Beginn 24.09. 02:00
                "WINDBÖEN",         // gering, Beginn 24.09. 11:00
            ]
        );
        // Genau am Ende gilt eine Warnung nicht mehr (`ende ≤ jetzt`).
        let g = gueltige(warnungen, t("2026-09-24T11:00:00Z"));
        assert!(!ereignisse(&g).contains(&"STURMBÖEN"));
        assert!(
            ereignisse(&g).contains(&"ORKANBÖEN"),
            "ohne Ende bleibt sie"
        );
    }

    #[test]
    fn gleiche_stufe_ohne_beginn_zuerst() {
        let w = |ereignis: &str, beginn: Option<&str>| WetterWarnung {
            stufe: WetterWarnstufe::Maessig,
            ereignis: ereignis.into(),
            ueberschrift: ereignis.into(),
            beschreibung: None,
            handlungsempfehlung: None,
            beginn: beginn.map(str::to_string),
            ende: None,
            ausgegeben: None,
        };
        let g = gueltige(
            vec![
                w("spaet", Some("2026-09-23T18:00:00Z")),
                w("ohne", None),
                w("frueh", Some("2026-09-23T08:00:00Z")),
            ],
            t("2026-09-23T12:00:00Z"),
        );
        assert_eq!(ereignisse(&g), vec!["ohne", "frueh", "spaet"]);
    }

    #[test]
    fn weather_station_aus_source_id() {
        let v = parse_weather(&weather()).unwrap();
        assert_eq!(v.station.as_deref(), Some("BREMEN"));
        assert_eq!(v.entfernung_m, Some(3340.0));
        assert_eq!(v.stunden.len(), 25);
        assert_eq!(v.stunden[0].zeitpunkt, "2026-09-23T12:00:00Z");
        assert_eq!(
            v.stunden[0],
            WetterStunde {
                zeitpunkt: "2026-09-23T12:00:00Z".into(),
                temperatur_c: Some(18.6),
                niederschlag_mm: Some(0.0),
                niederschlag_wahrscheinlichkeit: Some(2.0),
                wind_kmh: Some(11.1),
                boeen_kmh: Some(18.5),
                windrichtung_grad: Some(192.0),
            }
        );
    }

    #[test]
    fn null_bleibt_none_und_wird_nicht_null() {
        let v = parse_weather(&weather()).unwrap();
        assert_eq!(v.stunden[1].niederschlag_wahrscheinlichkeit, None);
        assert_eq!(v.stunden[2].temperatur_c, None);
        assert_eq!(v.stunden[2].niederschlag_mm, None);
        assert_eq!(v.stunden[3].windrichtung_grad, None);
        assert_eq!(v.stunden[3].boeen_kmh, None);
        // Die gemessene 0,0 mm bleibt eine echte 0.
        assert_eq!(v.stunden[1].niederschlag_mm, Some(0.0));
        let draht = serde_json::to_value(&v.stunden[2]).unwrap();
        assert!(!draht.as_object().unwrap().contains_key("temperatur_c"));
    }

    #[test]
    fn station_rueckfall_und_leere_antwort() {
        let roh = json!({
            "weather": [{ "timestamp": "2026-09-23T13:00:00+00:00", "source_id": 99,
                          "temperature": 10.0 },
                        { "timestamp": "2026-09-23T12:00:00+00:00", "source_id": 99 },
                        { "timestamp": "kaputt" }],
            "sources": [{ "id": 1, "station_name": "ERSTE", "distance": 1200.5 }]
        });
        let v = parse_weather(&roh).unwrap();
        assert_eq!(
            v.station.as_deref(),
            Some("ERSTE"),
            "Rückfall: erste Quelle"
        );
        assert_eq!(v.entfernung_m, Some(1200.5));
        let zeiten: Vec<&str> = v.stunden.iter().map(|s| s.zeitpunkt.as_str()).collect();
        assert_eq!(zeiten, vec!["2026-09-23T12:00:00Z", "2026-09-23T13:00:00Z"]);

        let leer = parse_weather(&json!({ "weather": [], "sources": [] })).unwrap();
        assert_eq!(leer.station, None);
        assert!(leer.stunden.is_empty());
        assert!(parse_weather(&json!({ "title": "Not Found" })).is_none());
    }

    #[test]
    fn kommende_stunden_ab_der_laufenden_stunde() {
        let v = parse_weather(&weather()).unwrap();
        let k = kommende_stunden(v, t("2026-09-23T14:59:59Z"));
        assert_eq!(k.stunden[0].zeitpunkt, "2026-09-23T14:00:00Z");
        assert_eq!(k.stunden.len(), 23);
        assert_eq!(k.station.as_deref(), Some("BREMEN"));
    }
}
