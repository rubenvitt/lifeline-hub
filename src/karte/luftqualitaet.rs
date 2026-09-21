//! Reine Bausteine der Fachebene „Luftqualität (UBA)" (LFH-79): Indexstufe, Zeitumrechnung,
//! Abfragefenster, Leitschadstoff und Normalisierung. Der Abruf selbst liegt in
//! `karte::quellen::fetch_luftqualitaet`; Herleitung und Messprotokoll der Quelle stehen in
//! `docs/fachebenen-quellen.md`.

use chrono::{DateTime, Duration, FixedOffset, NaiveDate, NaiveDateTime, Timelike, Utc};
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// Die Quelle führt ihre Zeitpunkte in MEZ **ohne Sommerzeit** — `indices` sagt wörtlich
/// `date start (CET)`, und ein Abruf um 11:39 MESZ lieferte als jüngste Stunde den Start
/// 08:00. Deshalb ein fester Versatz und ausdrücklich NICHT `Europe/Berlin`: eine
/// zonenbewusste Umrechnung verschöbe jeden Sommerwert still um eine Stunde.
fn mez() -> FixedOffset {
    FixedOffset::east_opt(3600).expect("UTC+1 ist ein gültiger Versatz")
}

/// Indexstufe des UBA-Luftqualitätsindex als Wire-Wert.
///
/// Die Skala ist 0-basiert, 0 = „sehr gut" — gemessen gegen die UBA-Klassengrenzen
/// (NO₂ 0–20 → 0, 21–40 → 1, 41–54 → 2; O₃ 0–60 → 0, 61–90 → 1).
///
/// Diese Zeichenketten sind der Wire-Vertrag zu `frontend/src/api/fachebenen.ts`
/// (`LuftqualitaetKlasse`) und dort gepinnt. Sie stehen in KEINEM OpenAPI-Schema:
/// Fachebenen-Properties sind `HashMap<String, Value>`, ein registriertes Enum wäre eine
/// Waise (dieselbe Begründung wie bei `hochwasser_klasse`).
pub fn luftqualitaet_klasse(index: Option<i64>) -> &'static str {
    match index {
        Some(0) => "sehr_gut",
        Some(1) => "gut",
        Some(2) => "maessig",
        Some(3) => "schlecht",
        Some(4) => "sehr_schlecht",
        // Fehlend oder außerhalb der Skala: keine erfundene Stufe.
        _ => "keine_daten",
    }
}

/// MEZ-Zeitpunkt der Quelle (`YYYY-MM-DD HH:MM:SS`) als naive Ortszeit. Die Quelle schreibt
/// das Ende der letzten Tagesstunde als `…-20 24:00:00` (gemessen) — kein gültiger Wert
/// für einen Parser, also 00:00 des Folgetags.
fn parse_mez(s: &str) -> Option<NaiveDateTime> {
    let s = s.trim();
    if let Some(datum) = s.strip_suffix(" 24:00:00") {
        let tag = NaiveDate::parse_from_str(datum, "%Y-%m-%d").ok()?;
        return tag.succ_opt()?.and_hms_opt(0, 0, 0);
    }
    NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok()
}

/// MEZ-Stundenende der Quelle → RFC 3339 mit `+01:00` (derselbe absolute Moment).
pub fn luftqualitaet_zeitpunkt(ende_mez: &str) -> Option<String> {
    let naiv = parse_mez(ende_mez)?;
    let mit_zone = naiv.and_local_timezone(mez()).single()?;
    Some(mit_zone.to_rfc3339())
}

/// Stundenende als Parameterpaar der Quelle: Datum und Stunde 1–24. Die Stunde, die um
/// Mitternacht endet, heisst `24` des Vortags, nicht `0` des Folgetags.
fn als_stundenende(ende: NaiveDateTime) -> (String, String) {
    if ende.hour() == 0 {
        let vortag = ende.date().pred_opt().unwrap_or(ende.date());
        (vortag.format("%Y-%m-%d").to_string(), "24".to_string())
    } else {
        (ende.format("%Y-%m-%d").to_string(), ende.hour().to_string())
    }
}

/// Anzahl der Stunden im Abfragefenster. Das Fenster endet mit der LAUFENDEN Stunde, und bei
/// gemessenen 1,5–2,5 h Verzug sind deren jüngste zwei bis drei Stundenenden noch leer. Acht
/// Stunden lassen damit rund fünf Stunden Daten übrig — Reserve für Nachzügler (gemessen eine
/// weitere Stunde) und für einen Importausfall der Quelle von etwa vier Stunden, bevor eine
/// Station aus der Ebene fällt. Kostet gemessen ~210 KB statt ~300 KB für einen ganzen Tag.
const FENSTER_STUNDEN: i64 = 8;

/// Query-Parameter des Indexabrufs für die letzten acht Stunden (MEZ). `time_*` sind
/// Stundenenden 1–24 (gemessen: `time_from=1` ↔ `datetime_from 00:00`); das Fenster endet
/// mit der laufenden Stunde.
pub fn luftqualitaet_fenster(jetzt: DateTime<Utc>) -> [(&'static str, String); 4] {
    let ortszeit = jetzt.with_timezone(&mez()).naive_local();
    let stundenbeginn = ortszeit
        .date()
        .and_hms_opt(ortszeit.hour(), 0, 0)
        .unwrap_or(ortszeit);
    let ende = stundenbeginn + Duration::hours(1);
    let anfang = ende - Duration::hours(FENSTER_STUNDEN - 1);
    let (date_from, time_from) = als_stundenende(anfang);
    let (date_to, time_to) = als_stundenende(ende);
    [
        ("date_from", date_from),
        ("time_from", time_from),
        ("date_to", date_to),
        ("time_to", time_to),
    ]
}

/// Eine Index-Komponente: `[komp_id, wert, teilindex, y]`. `y` ist gemessen der Wert relativ
/// zur Obergrenze der „sehr gut"-Klasse (O₃ 60 → 1, PM10 12 → 0,6) und damit über
/// Komponenten vergleichbar — er entscheidet einen Gleichstand beim Teilindex.
struct Komponente {
    id: i64,
    wert: Option<Value>,
    teilindex: i64,
    y: f64,
}

fn komponente(v: &Value) -> Option<Komponente> {
    let a = v.as_array()?;
    let zahl_i = |v: Option<&Value>| match v? {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    };
    let zahl_f = |v: Option<&Value>| match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    };
    Some(Komponente {
        id: zahl_i(a.first())?,
        wert: a.get(1).filter(|w| w.is_number()).cloned(),
        teilindex: zahl_i(a.get(2)).unwrap_or(-1),
        y: zahl_f(a.get(3)).unwrap_or(0.0),
    })
}

/// Komponenten-ID des Leitschadstoffs: höchster Teilindex, bei Gleichstand der höhere `y`.
pub fn leitschadstoff(komponenten: &[Value]) -> Option<i64> {
    komponenten
        .iter()
        .filter_map(komponente)
        .max_by(|a, b| {
            a.teilindex
                .cmp(&b.teilindex)
                .then(a.y.partial_cmp(&b.y).unwrap_or(std::cmp::Ordering::Equal))
        })
        .map(|k| k.id)
}

/// Komponenten-ID → (Property-Schlüssel, Anzeigekürzel, Einheit). Aus dem Katalog der Quelle
/// (`/components/json`) übernommen statt je Lauf abgerufen: ein dritter Aufruf verdoppelte die
/// Ausfallfläche für ein Etikett. Im Index kommen gemessen PM10, O₃ und NO₂ vor.
fn komponenten_etikett(id: i64) -> (String, String, Option<&'static str>) {
    let bekannt = match id {
        1 => Some(("pm10", "PM10", "µg/m³")),
        2 => Some(("co", "CO", "mg/m³")),
        3 => Some(("o3", "O₃", "µg/m³")),
        4 => Some(("so2", "SO₂", "µg/m³")),
        5 => Some(("no2", "NO₂", "µg/m³")),
        9 => Some(("pm25", "PM2,5", "µg/m³")),
        _ => None,
    };
    match bekannt {
        Some((schluessel, kuerzel, einheit)) => {
            (schluessel.to_string(), kuerzel.to_string(), Some(einheit))
        }
        // Unbekannt: Wert behalten, Etikett ehrlich generisch.
        None => (format!("k{id}"), format!("Komponente {id}"), None),
    }
}

/// Spaltenpositionen der Stationsliste, aus `indices` gelesen statt hart kodiert.
struct Spalten {
    id: usize,
    code: usize,
    name: usize,
    ort: usize,
    lon: usize,
    lat: usize,
    umgebung: Option<usize>,
    typ: Option<usize>,
}

impl Spalten {
    fn aus(indices: &[Value]) -> Option<Spalten> {
        let pos = |name: &str| indices.iter().position(|v| v.as_str() == Some(name));
        Some(Spalten {
            id: pos("station id")?,
            code: pos("station code")?,
            name: pos("station name")?,
            ort: pos("station city")?,
            lon: pos("station longitude")?,
            lat: pos("station latitude")?,
            umgebung: pos("station setting name"),
            typ: pos("station type name"),
        })
    }
}

/// Getrimmter Text einer Stationsspalte.
fn text(zeile: &[Value], pos: usize) -> Option<&str> {
    zeile.get(pos).and_then(|v| v.as_str()).map(str::trim)
}

/// Stationsliste + Indexantwort → (FeatureCollection, stand).
///
/// * **Der Indexabruf treibt** (design D1): Features entstehen nur für Stationen mit
///   Indexeintrag; die Stationsliste liefert Koordinaten und Stammdaten.
/// * **Auflösung über ID UND Code** (design D3): das `request.index`-Echo der Quelle meldet
///   gemessen `code`, obwohl nach ID geschlüsselt ist. Eine reine ID-Tabelle bliebe bei einem
///   echten Umschalten still leer.
/// * `None` heisst **unbrauchbar** (→ offline), nicht „leer": eine kaputte Antwort darf nicht
///   als gültiger Leerstand in den Cache.
pub fn normalisiere_luftqualitaet(
    stationen: &Value,
    index: &Value,
) -> Option<(Value, Option<String>)> {
    let spalten = Spalten::aus(stationen.get("indices")?.as_array()?)?;
    let zeilen = stationen.get("data")?.as_object()?;
    let werte = index.get("data")?.as_object()?;

    let mut tabelle: HashMap<String, &Vec<Value>> = HashMap::new();
    for zeile in zeilen.values().filter_map(|z| z.as_array()) {
        for pos in [spalten.id, spalten.code] {
            if let Some(schluessel) = zeile.get(pos).and_then(|v| v.as_str()) {
                tabelle.insert(schluessel.to_string(), zeile);
            }
        }
    }

    let koordinate = |z: &Vec<Value>, pos: usize| -> Option<f64> {
        let w = match z.get(pos)? {
            Value::Number(n) => n.as_f64()?,
            Value::String(s) => s.trim().parse::<f64>().ok()?,
            _ => return None,
        };
        w.is_finite().then_some(w)
    };

    let mut stand: Option<DateTime<FixedOffset>> = None;
    let mut features = Vec::new();
    for (schluessel, stunden) in werte {
        let Some(zeile) = tabelle.get(schluessel.as_str()) else {
            continue;
        };
        let (Some(lon), Some(lat)) = (
            koordinate(zeile, spalten.lon),
            koordinate(zeile, spalten.lat),
        ) else {
            continue;
        };
        // Jüngster Stundenwert: die Schlüssel sind `YYYY-MM-DD HH:MM:SS`, also
        // lexikographisch gleich chronologisch.
        let Some(eintrag) = stunden
            .as_object()
            .and_then(|m| m.iter().max_by(|a, b| a.0.cmp(b.0)))
            .and_then(|(_, v)| v.as_array())
        else {
            continue;
        };

        let gesamt = eintrag.get(1).and_then(|v| v.as_i64());
        let klasse = luftqualitaet_klasse(gesamt);
        let komponenten = eintrag.get(3..).unwrap_or(&[]);

        let mut p = Map::new();
        let code = text(zeile, spalten.code).unwrap_or_default();
        let titel = text(zeile, spalten.name)
            .filter(|t| !t.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("Messstation {code}"));
        p.insert("titel".into(), json!(titel));
        p.insert("code".into(), json!(code));
        if let Some(ort) = text(zeile, spalten.ort).filter(|t| !t.is_empty()) {
            p.insert("ort".into(), json!(ort));
        }
        for (feld, pos) in [("umgebung", spalten.umgebung), ("stationstyp", spalten.typ)] {
            if let Some(t) = pos
                .and_then(|pos| text(zeile, pos))
                .filter(|t| !t.is_empty())
            {
                p.insert(feld.into(), json!(t));
            }
        }
        p.insert("kategorie".into(), json!("luftmessstation"));
        p.insert("klasse".into(), json!(klasse));
        if klasse != "keine_daten" {
            p.insert("index".into(), json!(gesamt));
            if let Some(leit) = leitschadstoff(komponenten) {
                p.insert("leitschadstoff".into(), json!(komponenten_etikett(leit).1));
            }
        }
        let unvollstaendig = matches!(eintrag.get(2), Some(v) if v.as_i64() == Some(1));
        p.insert("unvollstaendig".into(), json!(unvollstaendig));
        for k in komponenten.iter().filter_map(komponente) {
            let Some(wert) = k.wert else { continue };
            let (schluessel, _, einheit) = komponenten_etikett(k.id);
            p.insert(format!("wert_{schluessel}"), wert);
            if let Some(e) = einheit {
                p.insert(format!("einheit_{schluessel}"), json!(e));
            }
        }
        if let Some(ende) = eintrag.get(0).and_then(|v| v.as_str()) {
            if let Some(z) = luftqualitaet_zeitpunkt(ende) {
                if let Ok(t) = DateTime::parse_from_rfc3339(&z) {
                    stand = Some(stand.map_or(t, |s| s.max(t)));
                }
                p.insert("zeitpunkt".into(), json!(z));
            }
        }

        features.push(json!({
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [lon, lat] },
            "properties": Value::Object(p),
        }));
    }

    Some((
        json!({ "type": "FeatureCollection", "features": features }),
        stand.map(|s| s.to_rfc3339()),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;

    // ------------------------------------------------------------------ Indexstufe

    /// Die Literale sind der Wire-Vertrag zu `frontend/src/api/fachebenen.ts`
    /// (`LuftqualitaetKlasse`) und dort in `theme/statusFarben.test.ts` gepinnt.
    #[test]
    fn bildet_die_indexstufen_ab() {
        assert_eq!(luftqualitaet_klasse(Some(0)), "sehr_gut");
        assert_eq!(luftqualitaet_klasse(Some(1)), "gut");
        assert_eq!(luftqualitaet_klasse(Some(2)), "maessig");
        assert_eq!(luftqualitaet_klasse(Some(3)), "schlecht");
        assert_eq!(luftqualitaet_klasse(Some(4)), "sehr_schlecht");
    }

    #[test]
    fn fehlender_oder_fremder_index_ist_keine_daten() {
        assert_eq!(luftqualitaet_klasse(None), "keine_daten");
        assert_eq!(luftqualitaet_klasse(Some(-1)), "keine_daten");
        assert_eq!(luftqualitaet_klasse(Some(5)), "keine_daten");
    }

    // ------------------------------------------------------------------ Zeitpunkt

    fn absolut(rfc3339: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(rfc3339)
            .expect("gültiges RFC 3339")
            .with_timezone(&Utc)
    }

    /// Gegen den ABSOLUTEN Moment geprüft, nicht als Round-Trip: die Quelle führt MEZ ohne
    /// Sommerzeit. Eine Umrechnung über `Europe/Berlin` läge im September eine Stunde daneben.
    #[test]
    fn sommerwert_bleibt_mez_ohne_sommerzeit() {
        let z = luftqualitaet_zeitpunkt("2026-09-21 09:00:00").expect("parsebar");
        assert_eq!(
            absolut(&z),
            Utc.with_ymd_and_hms(2026, 9, 21, 8, 0, 0).unwrap()
        );
        assert!(z.ends_with("+01:00"), "Zonenangabe fehlt: {z}");
    }

    #[test]
    fn winterwert_ist_ebenfalls_utc_plus_eins() {
        let z = luftqualitaet_zeitpunkt("2026-01-15 13:00:00").expect("parsebar");
        assert_eq!(
            absolut(&z),
            Utc.with_ymd_and_hms(2026, 1, 15, 12, 0, 0).unwrap()
        );
    }

    /// Gemessen: das Ende der letzten Tagesstunde heisst `…-20 24:00:00`. Ein naiver Parse
    /// verwürfe genau die Mitternachtsstunde.
    #[test]
    fn stundenende_24_uhr_ist_mitternacht_des_folgetags() {
        let z = luftqualitaet_zeitpunkt("2026-09-20 24:00:00").expect("24:00 parsebar");
        assert_eq!(
            absolut(&z),
            Utc.with_ymd_and_hms(2026, 9, 20, 23, 0, 0).unwrap()
        );
    }

    #[test]
    fn unparsebarer_zeitpunkt_ist_none() {
        assert_eq!(luftqualitaet_zeitpunkt("gestern"), None);
        assert_eq!(luftqualitaet_zeitpunkt(""), None);
    }

    // ------------------------------------------------------------------ Abfragefenster

    fn fenster_map(jetzt: DateTime<Utc>) -> std::collections::HashMap<&'static str, String> {
        luftqualitaet_fenster(jetzt).into_iter().collect()
    }

    /// 11:39 MESZ = 09:39 UTC = 10:39 MEZ. Die laufende Stunde endet 11:00 MEZ; acht
    /// Stunden rückwärts sind die Stundenenden 04 … 11.
    #[test]
    fn fenster_im_sommer_rechnet_in_mez() {
        let f = fenster_map(Utc.with_ymd_and_hms(2026, 9, 21, 9, 39, 0).unwrap());
        assert_eq!(f["date_from"], "2026-09-21");
        assert_eq!(f["time_from"], "4");
        assert_eq!(f["date_to"], "2026-09-21");
        assert_eq!(f["time_to"], "11");
    }

    /// 00:30 MEZ: die laufende Stunde endet 01:00 heute; das Fenster beginnt mit dem
    /// Stundenende 18:00 des Vortags.
    #[test]
    fn fenster_ueber_den_tageswechsel() {
        let f = fenster_map(Utc.with_ymd_and_hms(2026, 9, 20, 23, 30, 0).unwrap());
        assert_eq!(f["date_from"], "2026-09-20");
        assert_eq!(f["time_from"], "18");
        assert_eq!(f["date_to"], "2026-09-21");
        assert_eq!(f["time_to"], "1");
    }

    #[test]
    fn fenster_endet_um_mitternacht_mit_24() {
        // 23:10 MEZ → laufende Stunde endet 24:00 desselben Tages.
        let f = fenster_map(Utc.with_ymd_and_hms(2026, 1, 15, 22, 10, 0).unwrap());
        assert_eq!(f["date_to"], "2026-01-15");
        assert_eq!(f["time_to"], "24");
        assert_eq!(f["time_from"], "17");
    }

    #[test]
    fn fenster_zur_vollen_stunde() {
        // 12:00:00 MEZ genau → die Stunde 12–13 hat begonnen und endet 13.
        let f = fenster_map(Utc.with_ymd_and_hms(2026, 1, 15, 11, 0, 0).unwrap());
        assert_eq!(f["time_to"], "13");
        assert_eq!(f["time_from"], "6");
    }

    /// Beginnt das Fenster genau mit dem Stundenende Mitternacht, heisst sein Anfang `24` des
    /// VORTAGS (06:30 MEZ → Stundenenden 24:00 Vortag … 07:00). Gegen die Live-API belegt:
    /// `time_from=24` wird angenommen und beginnt um 23:00.
    #[test]
    fn fensteranfang_um_mitternacht_ist_24_des_vortags() {
        let f = fenster_map(Utc.with_ymd_and_hms(2026, 9, 21, 5, 30, 0).unwrap());
        assert_eq!(f["date_from"], "2026-09-20");
        assert_eq!(f["time_from"], "24");
        assert_eq!(f["date_to"], "2026-09-21");
        assert_eq!(f["time_to"], "7");
    }

    // ------------------------------------------------------------------ Leitschadstoff

    #[test]
    fn leitschadstoff_ist_der_hoechste_teilindex() {
        // [komp_id, wert, teilindex, y]
        let k = vec![
            json!([3, 95, 1, "1.583"]),
            json!([5, 45, 2, "2.25"]),
            json!([1, 12, 0, "0.6"]),
        ];
        assert_eq!(leitschadstoff(&k), Some(5));
    }

    #[test]
    fn gleichstand_entscheidet_y() {
        let k = vec![
            json!([3, 58, 0, "0.967"]),
            json!([5, 3, 0, "0.15"]),
            json!([1, 13, 0, "0.65"]),
        ];
        assert_eq!(leitschadstoff(&k), Some(3));
    }

    #[test]
    fn ohne_komponenten_kein_leitschadstoff() {
        assert_eq!(leitschadstoff(&[]), None);
        assert_eq!(leitschadstoff(&[json!("kaputt")]), None);
    }

    // ------------------------------------------------------------------ Normalisierung

    /// Stationsliste im gemessenen Format: Zeilen als Arrays, Spaltennamen in `indices`,
    /// Koordinaten als Zeichenketten. Station 99 hat keinen Indexeintrag, Station 7 keine
    /// brauchbaren Koordinaten.
    fn stationen() -> Value {
        json!({
            "indices": ["station id", "station code", "station name", "station city",
                        "station synonym", "station active from", "station active to",
                        "station longitude", "station latitude", "network id",
                        "station setting id", "station type id", "network code", "network name",
                        "station setting name", "station setting short name", "station type name"],
            "data": {
                "21": ["21", "DEBB021", "Potsdam-Zentrum", "Potsdam", "", "1991-01-01", null,
                       "13.0647", "52.3985", "4", "1", "3", "BB", "Brandenburg",
                       "städtisches Gebiet", "städtisch", "Verkehr"],
                "31": ["31", "DEBB031", "Frankfurt (Oder)", "Frankfurt (Oder)", "", "1995-01-01", null,
                       "14.5386", "52.3373", "4", "2", "1", "BB", "Brandenburg",
                       "vorstädtisches Gebiet", "vorstädtisch", "Hintergrund"],
                "7":  ["7", "DEBB007", "Ohne Ort", "Nirgendwo", "", "1991-01-01", null,
                       "", "kaputt", "4", "1", "3", "BB", "Brandenburg",
                       "städtisches Gebiet", "städtisch", "Verkehr"],
                "99": ["99", "DEBB099", "Stumm", "Stumm", "", "1991-01-01", null,
                       "13.0", "52.0", "4", "1", "3", "BB", "Brandenburg",
                       "städtisches Gebiet", "städtisch", "Verkehr"]
            }
        })
    }

    /// Indexantwort im gemessenen Format, nach ID geschlüsselt.
    fn index_nach_id() -> Value {
        json!({
            "data": {
                "21": {
                    "2026-09-21 07:00:00": ["2026-09-21 08:00:00", 0, 0, [3, 55, 0, "0.917"]],
                    "2026-09-21 08:00:00": ["2026-09-21 09:00:00", 2, 1,
                                            [3, 95, 1, "1.583"], [5, 45, 2, "2.25"], [1, 12, 0, "0.6"]]
                },
                "31": {
                    "2026-09-21 06:00:00": ["2026-09-21 07:00:00", 0, 0, [3, 51, 0, "0.85"], [5, 3, 0, "0.15"]]
                },
                "7": {
                    "2026-09-21 08:00:00": ["2026-09-21 09:00:00", 1, 0, [5, 30, 1, "1.5"]]
                }
            }
        })
    }

    fn features(fc: &Value) -> &Vec<Value> {
        fc["features"].as_array().expect("features-Array")
    }

    fn feature<'a>(fc: &'a Value, code: &str) -> &'a Value {
        features(fc)
            .iter()
            .find(|f| f["properties"]["code"] == code)
            .unwrap_or_else(|| panic!("kein Feature {code}"))
    }

    #[test]
    fn zeichnet_nur_stationen_mit_index_und_koordinaten() {
        let (fc, _) =
            normalisiere_luftqualitaet(&stationen(), &index_nach_id()).expect("brauchbar");
        let mut codes: Vec<&str> = features(&fc)
            .iter()
            .map(|f| f["properties"]["code"].as_str().unwrap())
            .collect();
        codes.sort();
        // 99: kein Index · 7: keine Koordinaten — beides fällt weg, der Rest bleibt.
        assert_eq!(codes, ["DEBB021", "DEBB031"]);
    }

    #[test]
    fn traegt_den_juengsten_stundenwert() {
        let (fc, _) = normalisiere_luftqualitaet(&stationen(), &index_nach_id()).unwrap();
        let p = &feature(&fc, "DEBB021")["properties"];
        assert_eq!(p["klasse"], "maessig");
        assert_eq!(p["index"], 2);
        assert_eq!(p["leitschadstoff"], "NO₂");
        assert_eq!(p["unvollstaendig"], true);
        assert_eq!(p["wert_no2"], 45);
        assert_eq!(p["einheit_no2"], "µg/m³");
        assert_eq!(p["wert_o3"], 95);
        assert_eq!(p["wert_pm10"], 12);
        assert_eq!(
            absolut(p["zeitpunkt"].as_str().unwrap()),
            Utc.with_ymd_and_hms(2026, 9, 21, 8, 0, 0).unwrap()
        );
    }

    #[test]
    fn traegt_stammdaten_und_zahlige_koordinaten() {
        let (fc, _) = normalisiere_luftqualitaet(&stationen(), &index_nach_id()).unwrap();
        let f = feature(&fc, "DEBB031");
        assert_eq!(f["geometry"]["type"], "Point");
        assert_eq!(f["geometry"]["coordinates"], json!([14.5386, 52.3373]));
        let p = &f["properties"];
        assert_eq!(p["titel"], "Frankfurt (Oder)");
        assert_eq!(p["ort"], "Frankfurt (Oder)");
        assert_eq!(p["kategorie"], "luftmessstation");
        assert_eq!(p["stationstyp"], "Hintergrund");
        assert_eq!(p["umgebung"], "vorstädtisches Gebiet");
        assert_eq!(p["klasse"], "sehr_gut");
        assert_eq!(p["unvollstaendig"], false);
    }

    #[test]
    fn stand_ist_der_juengste_messzeitpunkt() {
        let (_, stand) = normalisiere_luftqualitaet(&stationen(), &index_nach_id()).unwrap();
        assert_eq!(
            absolut(&stand.expect("stand")),
            Utc.with_ymd_and_hms(2026, 9, 21, 8, 0, 0).unwrap()
        );
    }

    /// Gemessen: das `request.index`-Echo der Quelle meldet `code`, obwohl nach ID geschlüsselt
    /// ist. Liefe sie wirklich nach Code aus, bliebe eine reine ID-Auflösung STILL leer.
    #[test]
    fn nach_code_geschluesselt_ergibt_dieselben_features() {
        let mut nach_code = index_nach_id();
        let daten = nach_code["data"].as_object_mut().unwrap();
        let umbenannt: serde_json::Map<String, Value> = daten
            .iter()
            .map(|(id, v)| (format!("DEBB{:0>3}", id), v.clone()))
            .collect();
        nach_code["data"] = Value::Object(umbenannt);
        let (a, _) = normalisiere_luftqualitaet(&stationen(), &index_nach_id()).unwrap();
        let (b, _) = normalisiere_luftqualitaet(&stationen(), &nach_code).unwrap();
        assert_eq!(features(&b).len(), 2);
        assert_eq!(feature(&a, "DEBB021"), feature(&b, "DEBB021"));
    }

    #[test]
    fn erreichbar_aber_ohne_werte_ist_leere_collection() {
        let (fc, stand) = normalisiere_luftqualitaet(&stationen(), &json!({ "data": {} })).unwrap();
        assert!(features(&fc).is_empty());
        assert_eq!(stand, None);
    }

    /// Strukturbruch der Quelle ist „unbrauchbar" (→ offline), nicht „leer": sonst stünde
    /// eine kaputte Antwort 15 Minuten als gültiger Leerstand im Cache.
    #[test]
    fn unbrauchbare_antworten_sind_none() {
        assert!(normalisiere_luftqualitaet(&json!({}), &index_nach_id()).is_none());
        assert!(normalisiere_luftqualitaet(&stationen(), &json!({ "fehler": 1 })).is_none());
        let ohne_spalten = json!({ "indices": ["station id"], "data": {} });
        assert!(normalisiere_luftqualitaet(&ohne_spalten, &index_nach_id()).is_none());
    }

    #[test]
    fn fehlender_index_bleibt_als_keine_daten_sichtbar() {
        let index = json!({ "data": { "31": { "2026-09-21 08:00:00": ["2026-09-21 09:00:00", null, 0] } } });
        let (fc, _) = normalisiere_luftqualitaet(&stationen(), &index).unwrap();
        let p = &feature(&fc, "DEBB031")["properties"];
        assert_eq!(p["klasse"], "keine_daten");
        assert!(p.get("index").is_none(), "kein erfundener Index");
        assert!(p.get("leitschadstoff").is_none());
    }

    #[test]
    fn unbekannte_komponente_behaelt_ihren_wert() {
        let index = json!({ "data": { "31": { "2026-09-21 08:00:00": ["2026-09-21 09:00:00", 1, 0, [42, 7, 1, "1.1"]] } } });
        let (fc, _) = normalisiere_luftqualitaet(&stationen(), &index).unwrap();
        let p = &feature(&fc, "DEBB031")["properties"];
        assert_eq!(p["wert_k42"], 7);
        assert_eq!(p["leitschadstoff"], "Komponente 42");
    }

    /// LFH-265: der Schema-Anker muss die real produzierte Form beschreiben.
    #[test]
    fn output_passt_auf_den_geojson_anker() {
        let (fc, _) = normalisiere_luftqualitaet(&stationen(), &index_nach_id()).unwrap();
        serde_json::from_value::<crate::karte::typen::GeoJsonFeatureCollection>(fc)
            .expect("Anker beschreibt die reale Luftqualitäts-Form");
    }
}
