//! Reine Auswertung der Bright-Sky-Antworten (LFH-633): `/alerts` → Warnzelle + Warnungen,
//! `/weather` → Vorhersage, `/current_weather` → jüngste Messung (LFH-864). Kein Netz, keine
//! Uhr — die Zeit kommt als `jetzt` herein.
//!
//! **Lieber zu niedrig als verschwiegen:** eine Warnung mit unbekanntem `severity` bleibt
//! stehen (als `gering`, geloggt), ebenso eine mit unbekannter Kategorie. Bewusst gefiltert
//! wird genau eine Kategorie: `health` (Hitze, UV) ist kein Wetterereignis im Einsatzsinn.

use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::Value;

use super::{
    WetterAktuell, WetterErgaenzung, WetterMessgroesse, WetterOrt, WetterStation, WetterStunde,
    WetterSymbol, WetterVorhersage, WetterWarnstufe, WetterWarnung,
};

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

/// Ab diesem Alter der Messung gilt sie nicht mehr als aktueller Stand (Spec „Datenstand und
/// Quellausfall“, 3 h nach der Messzeit).
pub const OBERGRENZE_MESSUNG_S: i64 = 3 * 3600;

/// Sonnenhöhe, ab der Tag gilt: −0,833° (Refraktion und Sonnenradius), wie Auf- und
/// Untergang definiert sind.
const HORIZONT_GRAD: f64 = -0.833;

/// Höhe der Sonne über dem Horizont in Grad, am Ort `lat`/`lon` (Grad) zur Zeit `zeit`.
/// Näherung des Astronomical Almanac (auch NOAA), auf etwa 0,01° genau — für Tag oder Nacht
/// mehr als genug. Rein.
fn sonnenhoehe_grad(lat: f64, lon: f64, zeit: DateTime<Utc>) -> f64 {
    // Tage seit J2000.0 (2000-01-01 12:00 UT).
    let n = zeit.timestamp() as f64 / 86_400.0 + 2_440_587.5 - 2_451_545.0;
    let mittlere_laenge = (280.460 + 0.985_647_4 * n).rem_euclid(360.0);
    let anomalie = (357.528 + 0.985_600_3 * n).rem_euclid(360.0).to_radians();
    let ekliptik_laenge =
        (mittlere_laenge + 1.915 * anomalie.sin() + 0.020 * (2.0 * anomalie).sin()).to_radians();
    let schiefe = (23.439 - 0.000_000_4 * n).to_radians();
    let rektaszension = (schiefe.cos() * ekliptik_laenge.sin()).atan2(ekliptik_laenge.cos());
    let deklination = (schiefe.sin() * ekliptik_laenge.sin()).asin();
    let sternzeit = (280.460_618_37 + 360.985_647_366_29 * n).rem_euclid(360.0);
    let stundenwinkel = (sternzeit + lon - rektaszension.to_degrees()).to_radians();
    let breite = lat.to_radians();
    (breite.sin() * deklination.sin() + breite.cos() * deklination.cos() * stundenwinkel.cos())
        .asin()
        .to_degrees()
}

/// Steht die Sonne am Ort zur Zeit über dem Horizont (Tag nach der Definition von Auf- und
/// Untergang)? Rein.
pub fn sonne_ueber_horizont(lat: f64, lon: f64, zeit: DateTime<Utc>) -> bool {
    sonnenhoehe_grad(lat, lon, zeit) > HORIZONT_GRAD
}

/// `icon` der Quelle → Wetterlage. `fog` trennt die Quelle nicht nach Tageszeit; das tut
/// `tag` (Sonnenstand an der Station). Unbekannt → `None` samt Log: ein falsches „klar“ wäre
/// eine erfundene Angabe.
fn symbol_aus_icon(icon: Option<&str>, tag: impl FnOnce() -> bool) -> Option<WetterSymbol> {
    let icon = icon?;
    Some(match icon {
        "clear-day" => WetterSymbol::KlarTag,
        "clear-night" => WetterSymbol::KlarNacht,
        "partly-cloudy-day" => WetterSymbol::TeilsBewoelktTag,
        "partly-cloudy-night" => WetterSymbol::TeilsBewoelktNacht,
        "cloudy" => WetterSymbol::Bewoelkt,
        "fog" if tag() => WetterSymbol::NebelTag,
        "fog" => WetterSymbol::NebelNacht,
        "wind" => WetterSymbol::Wind,
        "rain" => WetterSymbol::Regen,
        "sleet" => WetterSymbol::Schneeregen,
        "snow" => WetterSymbol::Schnee,
        "hail" => WetterSymbol::Hagel,
        "thunderstorm" => WetterSymbol::Gewitter,
        andere => {
            tracing::warn!("Bright Sky: unbekannte Wetterlage {andere:?}, ohne Symbol gezeigt");
            return None;
        }
    })
}

/// Feld von `/current_weather` → gezeigte Messgröße. Felder, die das Paneel nicht zeigt
/// (30-min-Werte, Sonnenschein, Strahlung, Böenrichtung), ergeben `None`.
fn messgroesse(feld: &str) -> Option<WetterMessgroesse> {
    Some(match feld {
        "temperature" => WetterMessgroesse::Temperatur,
        "wind_speed_10" | "wind_direction_10" => WetterMessgroesse::Wind,
        "wind_gust_speed_60" => WetterMessgroesse::Boeen,
        "precipitation_60" => WetterMessgroesse::Niederschlag,
        "icon" | "condition" => WetterMessgroesse::Wetterlage,
        "visibility" => WetterMessgroesse::Sicht,
        "cloud_cover" => WetterMessgroesse::Bewoelkung,
        "relative_humidity" => WetterMessgroesse::Luftfeuchte,
        "dew_point" => WetterMessgroesse::Taupunkt,
        "pressure_msl" => WetterMessgroesse::Luftdruck,
        _ => return None,
    })
}

fn wetter_station(q: &Value) -> Option<WetterStation> {
    Some(WetterStation {
        name: text(q, "station_name")?,
        entfernung_m: zahl(q, "distance"),
    })
}

/// `fallback_source_ids` → Ergänzungen je Station, in der Reihenfolge von `sources` (die
/// Quelle sortiert nach Entfernung), Größen in der Reihenfolge von [`WetterMessgroesse`]. Eine
/// Quelle, die `sources` nicht nennt, fällt heraus (geloggt) — ihr Wert bleibt stehen.
fn ergaenzungen(w: &Value, quellen: &[Value], haupt_id: Option<i64>) -> Vec<WetterErgaenzung> {
    let mut je_quelle: std::collections::BTreeMap<
        i64,
        std::collections::BTreeSet<WetterMessgroesse>,
    > = Default::default();
    if let Some(rueckgriff) = w.get("fallback_source_ids").and_then(Value::as_object) {
        for (feld, id) in rueckgriff {
            let (Some(groesse), Some(id)) = (messgroesse(feld), id.as_i64()) else {
                continue;
            };
            if Some(id) != haupt_id {
                je_quelle.entry(id).or_default().insert(groesse);
            }
        }
    }
    for id in je_quelle.keys() {
        if !quellen
            .iter()
            .any(|q| q.get("id").and_then(Value::as_i64) == Some(*id))
        {
            tracing::warn!(
                "Bright Sky: Ergänzung aus unbekannter Quelle {id}, ohne Herkunft gezeigt"
            );
        }
    }
    quellen
        .iter()
        .filter_map(|q| {
            let groessen = je_quelle.get(&q.get("id")?.as_i64()?)?;
            Some(WetterErgaenzung {
                station: wetter_station(q)?,
                groessen: groessen.iter().copied().collect(),
            })
        })
        .collect()
}

/// `/current_weather?lat&lon` → jüngste Messung. Die Station ist die Quelle aus `source_id`
/// (Rückfall: die erste). `None`, wenn Messung, lesbare Messzeit oder Station fehlen — ohne
/// sie gibt es keinen Stand und keine Herkunft.
pub fn parse_current_weather(roh: &Value) -> Option<WetterAktuell> {
    let w = roh.get("weather").filter(|w| w.is_object())?;
    let zeitpunkt = zeit(w.get("timestamp")?.as_str()?)?;
    let quellen: &[Value] = roh
        .get("sources")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let haupt_id = w.get("source_id").and_then(Value::as_i64);
    let haupt = quellen
        .iter()
        .find(|q| haupt_id.is_some() && q.get("id").and_then(Value::as_i64) == haupt_id)
        .or_else(|| quellen.first())?;
    let tag = || match (zahl(haupt, "lat"), zahl(haupt, "lon")) {
        (Some(lat), Some(lon)) => sonne_ueber_horizont(lat, lon, zeitpunkt),
        _ => {
            tracing::warn!("Bright Sky: Station ohne Lage, Nebel als Tag gezeigt");
            true
        }
    };
    Some(WetterAktuell {
        gemessen_at: zeitpunkt.to_rfc3339_opts(SecondsFormat::Secs, true),
        station: wetter_station(haupt)?,
        symbol: symbol_aus_icon(w.get("icon").and_then(Value::as_str), tag),
        temperatur_c: zahl(w, "temperature"),
        taupunkt_c: zahl(w, "dew_point"),
        luftfeuchte_prozent: zahl(w, "relative_humidity"),
        luftdruck_hpa: zahl(w, "pressure_msl"),
        sicht_m: zahl(w, "visibility"),
        bewoelkung_prozent: zahl(w, "cloud_cover"),
        wind_kmh: zahl(w, "wind_speed_10"),
        windrichtung_grad: zahl(w, "wind_direction_10"),
        boeen_kmh: zahl(w, "wind_gust_speed_60"),
        niederschlag_mm: zahl(w, "precipitation_60"),
        ergaenzt: ergaenzungen(w, quellen, haupt_id),
    })
}

/// Lässt eine Messung nur stehen, solange sie höchstens [`OBERGRENZE_MESSUNG_S`] alt ist —
/// auch ein gerade gelungener Abruf kann die Messung einer ausgefallenen Station tragen.
/// Unlesbare Messzeit → `None`.
pub fn frische_messung(a: WetterAktuell, jetzt: DateTime<Utc>) -> Option<WetterAktuell> {
    let gemessen = zeit(&a.gemessen_at)?;
    ((jetzt - gemessen).num_seconds() <= OBERGRENZE_MESSUNG_S).then_some(a)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Aufgezeichnete Antwort von `/alerts?lat=53.55&lon=8.58` (Bremerhaven): die zwei ersten
    /// Warnungen sind echt, dazu ergänzt je eine Warnung `severe`, `extreme` (ohne `expires`, ohne
    /// Beschreibung), mit unbekannter Stufe, der Kategorie `health` und eine abgelaufene.
    fn alerts() -> Value {
        serde_json::from_str(include_str!("testdaten/alerts.json")).unwrap()
    }

    /// Aufgezeichnete Antwort von `/weather?lat=53.08&lon=8.80` (Bremen, 25 Stunden ab 12:00Z).
    /// Ergänzt: eine SYNOP-Quelle VOR der MOSMIX-Station (die Station kommt aus `source_id`, nicht
    /// aus der Reihenfolge) und `null` an einzelnen Werten der Stunden 2–4.
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
    /// Aufgezeichnete Antwort von `/current_weather?lat=52.00&lon=9.50` (Hameln, 01.10.2026
    /// 06:00Z, unverändert): Hauptstation Ottenstein; Temperatur, Feuchte und Taupunkt ergänzt
    /// aus Hameln-Hastenbeck, Wind und Böen aus Hameln, Luftdruck, Bewölkung, Wetterlage und
    /// Sicht aus Alfeld, Sonnenschein und Strahlung (nicht gezeigt) aus Luegde-Paenbruch.
    fn current_weather() -> Value {
        serde_json::from_str(include_str!("testdaten/current_weather.json")).unwrap()
    }

    /// Kopie der Aufzeichnung mit geänderten Feldern der Messung.
    fn current_weather_mit(felder: Value) -> Value {
        let mut roh = current_weather();
        let w = roh["weather"].as_object_mut().unwrap();
        for (k, v) in felder.as_object().unwrap() {
            w.insert(k.clone(), v.clone());
        }
        roh
    }

    fn station(name: &str, entfernung_m: f64) -> WetterStation {
        WetterStation {
            name: name.into(),
            entfernung_m: Some(entfernung_m),
        }
    }

    #[test]
    fn current_weather_werte_der_hauptstation() {
        let a = parse_current_weather(&current_weather()).unwrap();
        assert_eq!(a.gemessen_at, "2026-10-01T06:00:00Z");
        assert_eq!(a.station, station("Ottenstein", 9034.0));
        assert_eq!(a.symbol, Some(WetterSymbol::Bewoelkt));
        assert_eq!(a.temperatur_c, Some(14.8));
        assert_eq!(a.taupunkt_c, Some(11.38));
        assert_eq!(a.luftfeuchte_prozent, Some(80.0));
        assert_eq!(a.luftdruck_hpa, Some(1020.8));
        assert_eq!(a.sicht_m, Some(53235.0));
        assert_eq!(a.bewoelkung_prozent, Some(100.0));
        assert_eq!(a.wind_kmh, Some(3.2));
        assert_eq!(a.windrichtung_grad, Some(50.0));
        assert_eq!(a.boeen_kmh, Some(4.7));
        assert_eq!(a.niederschlag_mm, Some(0.0), "gemessene 0,0 mm bleibt 0");
    }

    #[test]
    fn current_weather_fenster_10_60_60() {
        let a = parse_current_weather(&current_weather_mit(json!({
            "wind_speed_10": 11.0, "wind_speed_30": 12.0, "wind_speed_60": 13.0,
            "wind_direction_10": 140, "wind_direction_60": 200,
            "wind_gust_speed_10": 17.0, "wind_gust_speed_30": 21.0, "wind_gust_speed_60": 34.0,
            "precipitation_10": 0.1, "precipitation_30": 0.4, "precipitation_60": 1.2,
        })))
        .unwrap();
        assert_eq!(a.wind_kmh, Some(11.0), "mittlerer Wind: jüngste 10 min");
        assert_eq!(a.windrichtung_grad, Some(140.0));
        assert_eq!(a.boeen_kmh, Some(34.0), "Böe: stärkste der letzten Stunde");
        assert_eq!(
            a.niederschlag_mm,
            Some(1.2),
            "Niederschlag: Summe der letzten Stunde"
        );
    }

    #[test]
    fn current_weather_ergaenzungen_je_station() {
        let a = parse_current_weather(&current_weather()).unwrap();
        use WetterMessgroesse as M;
        assert_eq!(
            a.ergaenzt,
            vec![
                WetterErgaenzung {
                    station: station("Hameln-Hastenbeck", 11086.0),
                    groessen: vec![M::Temperatur, M::Luftfeuchte, M::Taupunkt],
                },
                WetterErgaenzung {
                    station: station("Hameln", 12094.0),
                    groessen: vec![M::Wind, M::Boeen],
                },
                WetterErgaenzung {
                    station: station("Alfeld", 21432.0),
                    groessen: vec![M::Wetterlage, M::Sicht, M::Bewoelkung, M::Luftdruck],
                },
            ],
            "Luegde-Paenbruch ergänzt nur Ungezeigtes und erscheint nicht"
        );
    }

    #[test]
    fn current_weather_ohne_rueckgriff_und_unbekannte_quelle() {
        let mut roh = current_weather();
        roh["weather"]["fallback_source_ids"] = json!(null);
        assert!(parse_current_weather(&roh).unwrap().ergaenzt.is_empty());

        // Eine Quelle, die `sources` nicht nennt: ihr Wert bleibt, ihre Herkunft fehlt.
        roh["weather"]["fallback_source_ids"] =
            json!({ "temperature": 999, "precipitation_60": 277810 });
        let a = parse_current_weather(&roh).unwrap();
        assert_eq!(a.temperatur_c, Some(14.8));
        assert_eq!(
            a.ergaenzt,
            vec![WetterErgaenzung {
                station: station("Hameln", 12094.0),
                groessen: vec![WetterMessgroesse::Niederschlag],
            }]
        );
    }

    #[test]
    fn current_weather_null_bleibt_none() {
        let a = parse_current_weather(&current_weather_mit(json!({
            "visibility": null, "temperature": null, "icon": null
        })))
        .unwrap();
        assert_eq!(a.sicht_m, None);
        assert_eq!(a.temperatur_c, None);
        assert_eq!(a.symbol, None);
        let draht = serde_json::to_value(&a).unwrap();
        assert!(!draht.as_object().unwrap().contains_key("sicht_m"));
    }

    #[test]
    fn current_weather_alle_symbole_und_das_unbekannte() {
        let symbol = |icon: &str| {
            parse_current_weather(&current_weather_mit(json!({ "icon": icon })))
                .unwrap()
                .symbol
        };
        use WetterSymbol as S;
        assert_eq!(symbol("clear-day"), Some(S::KlarTag));
        assert_eq!(symbol("clear-night"), Some(S::KlarNacht));
        assert_eq!(symbol("partly-cloudy-day"), Some(S::TeilsBewoelktTag));
        assert_eq!(symbol("partly-cloudy-night"), Some(S::TeilsBewoelktNacht));
        assert_eq!(symbol("cloudy"), Some(S::Bewoelkt));
        assert_eq!(symbol("wind"), Some(S::Wind));
        assert_eq!(symbol("rain"), Some(S::Regen));
        assert_eq!(symbol("sleet"), Some(S::Schneeregen));
        assert_eq!(symbol("snow"), Some(S::Schnee));
        assert_eq!(symbol("hail"), Some(S::Hagel));
        assert_eq!(symbol("thunderstorm"), Some(S::Gewitter));
        // 06:00Z am 01.10. in Ottenstein: Sonne knapp über dem Horizont.
        assert_eq!(symbol("fog"), Some(S::NebelTag));
        assert_eq!(symbol("tornado"), None, "unbekannt wird nie „klar“");
    }

    #[test]
    fn nebel_nach_sonnenstand_der_station() {
        let roh = current_weather_mit(json!({
            "timestamp": "2026-10-01T02:00:00+00:00", "icon": "fog"
        }));
        assert_eq!(
            parse_current_weather(&roh).unwrap().symbol,
            Some(WetterSymbol::NebelNacht)
        );
        // Ohne Lage der Station: Tag (und ein Log-Eintrag).
        let mut roh = roh;
        for q in roh["sources"].as_array_mut().unwrap() {
            q.as_object_mut().unwrap().remove("lat");
        }
        assert_eq!(
            parse_current_weather(&roh).unwrap().symbol,
            Some(WetterSymbol::NebelTag)
        );
    }

    #[test]
    fn current_weather_unvollstaendige_antwort() {
        assert!(parse_current_weather(&json!({ "title": "Not Found" })).is_none());
        assert!(parse_current_weather(&json!({ "weather": null, "sources": [] })).is_none());
        let ohne_zeit = current_weather_mit(json!({ "timestamp": "kaputt" }));
        assert!(
            parse_current_weather(&ohne_zeit).is_none(),
            "ohne Messzeit kein Stand"
        );
        let mut ohne_station = current_weather();
        ohne_station["sources"] = json!([]);
        assert!(
            parse_current_weather(&ohne_station).is_none(),
            "ohne Station keine Herkunft"
        );
        // Versatz in der Messzeit wird nach UTC umgerechnet.
        let a = parse_current_weather(&current_weather_mit(json!({
            "timestamp": "2026-10-01T08:00:00+02:00"
        })))
        .unwrap();
        assert_eq!(a.gemessen_at, "2026-10-01T06:00:00Z");
    }

    #[test]
    fn sonnenstand_bremen_und_jahreszeiten() {
        // Bremen, 01.10.2026: Aufgang etwa 05:24Z, Untergang etwa 17:05Z.
        let (lat, lon) = (53.08, 8.80);
        assert!(!sonne_ueber_horizont(lat, lon, t("2026-10-01T05:00:00Z")));
        assert!(sonne_ueber_horizont(lat, lon, t("2026-10-01T06:00:00Z")));
        assert!(sonne_ueber_horizont(lat, lon, t("2026-10-01T16:30:00Z")));
        assert!(!sonne_ueber_horizont(lat, lon, t("2026-10-01T17:30:00Z")));
        // Mittag und Mitternacht im Sommer und im Winter.
        assert!(sonne_ueber_horizont(lat, lon, t("2026-06-21T11:30:00Z")));
        assert!(!sonne_ueber_horizont(lat, lon, t("2026-06-21T23:30:00Z")));
        assert!(sonne_ueber_horizont(lat, lon, t("2026-12-21T11:30:00Z")));
        assert!(!sonne_ueber_horizont(lat, lon, t("2026-12-21T23:30:00Z")));
        // 21.12. in Bremen: Aufgang etwa 07:37Z. Um 07:40Z steht die Sonne bei etwa −0,4°,
        // also zwischen −0,833° und 0° — schon Tag nach der Definition des Aufgangs (Grenze
        // der Gegenprobe gegen eine Schwelle von 0°).
        assert!(sonne_ueber_horizont(lat, lon, t("2026-12-21T07:40:00Z")));
        assert!(!sonne_ueber_horizont(lat, lon, t("2026-12-21T07:15:00Z")));
    }

    #[test]
    fn frische_messung_grenze_drei_stunden() {
        let a = parse_current_weather(&current_weather()).unwrap();
        let jetzt = |s: &str| t(s);
        assert!(frische_messung(a.clone(), jetzt("2026-10-01T08:00:00Z")).is_some());
        assert!(
            frische_messung(a.clone(), jetzt("2026-10-01T09:00:00Z")).is_some(),
            "genau 3 h gilt noch"
        );
        assert!(frische_messung(a.clone(), jetzt("2026-10-01T09:00:01Z")).is_none());
        let mut kaputt = a;
        kaputt.gemessen_at = "kaputt".into();
        assert!(frische_messung(kaputt, jetzt("2026-10-01T06:00:00Z")).is_none());
    }
}
