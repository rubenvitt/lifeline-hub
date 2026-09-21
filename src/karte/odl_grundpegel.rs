//! Standort-Grundpegel je ODL-Sonde und die relative Bewertung darauf (LFH-598).
//!
//! Alles hier ist rein und ohne Netz prüfbar; Abruf und Ablage stehen in
//! `karte::quellen` (`fetch_odl`). Herleitung, Messungen und verworfene Wege:
//! `openspec/changes/lfh-598-odl-standort-grundpegel/design.md`.

use chrono::{DateTime, Datelike, Duration, Timelike, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

/// Grundpegel einer Sonde, wie er im Cache unter [`CACHE_SCHLUESSEL`] liegt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Grundpegel {
    /// Unteres Quartil der Stichprobe in µSv/h.
    pub pegel: f64,
    /// Zahl der Stundenwerte, aus denen er gebildet ist.
    pub n: usize,
    /// Zeitpunkt der Berechnung, ISO-8601 UTC mit `Z` (wie `messende`).
    pub stand: String,
}

/// Kennung (`DEZ…`) → Grundpegel.
pub type GrundpegelKarte = BTreeMap<String, Grundpegel>;

pub const CACHE_SCHLUESSEL: &str = "odl:grundpegel";

/// Unter dieser Zahl Stundenwerte gibt es keinen Grundpegel (≈ fünf von sieben Tagen).
pub const MINDESTZAHL: usize = 20;
/// Faktor-Schwellen (Projekt-Einteilung, inklusiv nach unten wie die Bänder aus LFH-78).
/// 3 × ist der vom BfS genannte Faktor, hier standortbezogen gemeint — wie beim BfS.
pub const FAKTOR_ERHOEHT: f64 = 1.5;
pub const FAKTOR_STARK: f64 = 3.0;
/// Sperrklinke: eine Neuberechnung, die den Grundpegel um diesen Faktor oder mehr anhebt,
/// wird verworfen. Dieselbe Schwelle wie `erhoeht` — ein Anstieg, der eine Sonde auffällig
/// machte, ist in einer Lage genau das, was nicht in den Maßstab wandern darf.
pub const SPERRKLINKE: f64 = FAKTOR_ERHOEHT;

const EINHEIT: &str = "µSv/h";
const GLEITKOMMA_TOLERANZ: f64 = 1e-9;
/// Zeitpunkte der Stichprobe: 6-h-Raster, höchstens 28, innerhalb der sieben Tage, die die
/// Quelle vorhält (gemessen ~167 h).
const RASTER_STUNDEN: i64 = 6;
const STICHPROBEN: i64 = 28;
const FENSTER_STUNDEN: i64 = 7 * 24;

/// ISO-8601 UTC mit `Z`, sekundengenau. Von Hand, weil `chrono` hier ohne `alloc`-Formatierer
/// gebaut ist.
pub fn iso_utc(t: DateTime<Utc>) -> String {
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        t.year(),
        t.month(),
        t.day(),
        t.hour(),
        t.minute(),
        t.second()
    )
}

/// Stichproben-Zeitpunkte (`end_measure`) für den Abruf, jüngster zuerst.
///
/// Start ist die letzte volle Rasterstunde VOR `jetzt − 1 h`: der Stundenwert der gerade
/// abgelaufenen Stunde ist gemessen noch nicht für alle Sonden veröffentlicht.
pub fn zeitpunkte(jetzt: DateTime<Utc>) -> Vec<DateTime<Utc>> {
    let basis = jetzt - Duration::hours(1);
    let stunde = basis.hour() as i64;
    let start = basis
        .with_minute(0)
        .and_then(|t| t.with_second(0))
        .and_then(|t| t.with_nanosecond(0))
        .expect("volle Stunde ist immer gültig")
        - Duration::hours(stunde % RASTER_STUNDEN);
    let grenze = jetzt - Duration::hours(FENSTER_STUNDEN);
    (0..STICHPROBEN)
        .map(|k| start - Duration::hours(k * RASTER_STUNDEN))
        .filter(|t| *t > grenze)
        .collect()
}

/// CQL-Filter über die Zeitpunkte (noch nicht URL-kodiert).
pub fn cql_filter(zeitpunkte: &[DateTime<Utc>]) -> String {
    let liste: Vec<String> = zeitpunkte
        .iter()
        .map(|t| format!("'{}'", iso_utc(*t)))
        .collect();
    format!("end_measure IN ({})", liste.join(","))
}

/// Unteres Quartil nach dem Nächster-Rang-Verfahren. `werte` darf unsortiert sein.
fn unteres_quartil(werte: &mut [f64]) -> Option<f64> {
    if werte.is_empty() {
        return None;
    }
    werte.sort_by(f64::total_cmp);
    let rang = (werte.len() as f64 * 0.25).ceil() as usize;
    Some(werte[rang.max(1) - 1])
}

/// Rohe Zeitreihen-Antwort → Grundpegel je Sonde als `(pegel, n)`.
///
/// Gezählt werden nur Zahlwerte unter `µSv/h`; fehlt `unit`, gilt wie in
/// `normalisiere_odl` µSv/h als dokumentierte Einheit. Sonden mit weniger als
/// [`MINDESTZAHL`] Werten und Pegel ≤ 0 fallen weg: durch null lässt sich kein Faktor
/// bilden, und ein Grundpegel aus drei Tagen ist keiner.
pub fn berechne(roh: &Value) -> BTreeMap<String, (f64, usize)> {
    let mut je_sonde: BTreeMap<String, Vec<f64>> = BTreeMap::new();
    for f in roh
        .get("features")
        .and_then(|f| f.as_array())
        .into_iter()
        .flatten()
    {
        let Some(p) = f.get("properties") else {
            continue;
        };
        let text = |k: &str| {
            p.get(k)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|t| !t.is_empty())
        };
        if text("unit").is_some_and(|e| e != EINHEIT) {
            continue;
        }
        let (Some(kennung), Some(wert)) = (
            text("id").or_else(|| text("kenn")),
            p.get("value").and_then(|v| v.as_f64()),
        ) else {
            continue;
        };
        if wert.is_finite() {
            je_sonde.entry(kennung.to_string()).or_default().push(wert);
        }
    }
    je_sonde
        .into_iter()
        .filter(|(_, w)| w.len() >= MINDESTZAHL)
        .filter_map(|(k, mut w)| {
            let n = w.len();
            unteres_quartil(&mut w)
                .filter(|p| *p > 0.0)
                .map(|p| (k, (p, n)))
        })
        .collect()
}

/// Neue Berechnung gegen den gespeicherten Stand abgleichen (Sperrklinke).
///
/// Steigt eine Sonde um [`SPERRKLINKE`] oder mehr, bleibt ihr alter Eintrag samt `stand`
/// stehen. Sinken und leichtes Steigen werden übernommen. Eine Sonde, die in der neuen
/// Berechnung fehlt (zu wenige Werte), fällt heraus — sie wird dann absolut bewertet, wie es
/// die Spec für „zu wenig Historie" verlangt.
pub fn uebernimm(
    neu: BTreeMap<String, (f64, usize)>,
    alt: &GrundpegelKarte,
    stand: &str,
) -> GrundpegelKarte {
    neu.into_iter()
        .map(|(k, (pegel, n))| {
            let eintrag = match alt.get(&k) {
                // Toleranz statt blankem `>=`: 1,5 × 0,1 ergibt 0,150…02, und genau 0,15 soll
                // laut Spec („das 1,5-Fache oder mehr") verworfen werden. Die Quelle liefert
                // drei Nachkommastellen, 1e-9 verschiebt also keinen echten Wert.
                Some(a) if pegel >= SPERRKLINKE * a.pegel - GLEITKOMMA_TOLERANZ => a.clone(),
                _ => Grundpegel {
                    pegel,
                    n,
                    stand: stand.to_string(),
                },
            };
            (k, eintrag)
        })
        .collect()
}

/// Stufe aus Messwert und Grundpegel; die Grenze gehört zur unteren Stufe. Verglichen wird
/// über die Multiplikation plus [`GLEITKOMMA_TOLERANZ`], nicht über den Quotienten:
/// 0,3 ÷ 0,1 ergibt 2,999…, und ohne Toleranz hinge es am Rundungszufall des Produkts, ob
/// „genau 3 ×" zur unteren Stufe fällt.
fn relative_stufe(wert: f64, pegel: f64) -> &'static str {
    if wert <= FAKTOR_ERHOEHT * pegel + GLEITKOMMA_TOLERANZ {
        "normal"
    } else if wert <= FAKTOR_STARK * pegel + GLEITKOMMA_TOLERANZ {
        "erhoeht"
    } else {
        "stark_erhoeht"
    }
}

/// Bewertung bei Auslieferung: überschreibt `stufe` für jede Sonde mit Messwert in µSv/h und
/// Grundpegel und setzt `bewertung`, `grundpegel`, `faktor`, `grundpegel_stand`. Alle übrigen
/// behalten ihre absolute Stufe aus `normalisiere_odl` und bekommen `bewertung: "absolut"` —
/// OHNE die drei Felder (fehlend statt `null`, Norm ab LFH-265).
///
/// Die Wörter `standort`/`absolut` sind Wire-Vertrag zu `frontend/src/api/fachebenen.ts`
/// (`OdlBewertung`) und dort wie hier gepinnt.
pub fn bewerte(features: &mut Value, karte: &GrundpegelKarte) {
    let Some(liste) = features.get_mut("features").and_then(|f| f.as_array_mut()) else {
        return;
    };
    for f in liste {
        let Some(p) = f.get_mut("properties").and_then(|p| p.as_object_mut()) else {
            continue;
        };
        let wert = p.get("wert").and_then(|v| v.as_f64());
        let in_einheit = p.get("einheit").and_then(|v| v.as_str()) == Some(EINHEIT);
        let pegel = p
            .get("kennung")
            .and_then(|k| k.as_str())
            .and_then(|k| karte.get(k));
        match (wert, pegel) {
            (Some(w), Some(g)) if in_einheit => {
                p.insert("stufe".into(), relative_stufe(w, g.pegel).into());
                p.insert("bewertung".into(), "standort".into());
                p.insert("grundpegel".into(), g.pegel.into());
                p.insert(
                    "faktor".into(),
                    ((w / g.pegel * 100.0).round() / 100.0).into(),
                );
                p.insert("grundpegel_stand".into(), g.stand.clone().into());
            }
            _ => {
                p.insert("bewertung".into(), "absolut".into());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use serde_json::json;

    /// Echte Werte aus `odlinfo_timeseries_odl_1h` (abgerufen 21.09.2026, 27 Zeitpunkte im
    /// 6-h-Raster, `propertyName=id,end_measure,value`): Flensburg mit allen 27 Werten und
    /// Vahlberg — eine der 17 Sonden mit weniger als 20 Werten in dieser Stichprobe.
    const FLENSBURG: [f64; 27] = [
        0.089, 0.089, 0.088, 0.089, 0.089, 0.092, 0.091, 0.089, 0.088, 0.091, 0.091, 0.106, 0.088,
        0.089, 0.087, 0.09, 0.089, 0.094, 0.097, 0.092, 0.088, 0.09, 0.085, 0.087, 0.087, 0.086,
        0.087,
    ];
    const VAHLBERG: [f64; 10] = [
        0.126, 0.13, 0.124, 0.127, 0.127, 0.146, 0.124, 0.125, 0.124, 0.126,
    ];

    fn wert(id: &str, name: &str, v: Value) -> Value {
        json!({
            "type": "Feature", "geometry": null,
            "properties": { "id": id, "name": name, "end_measure": "2026-09-15T01:00:00Z", "value": v }
        })
    }

    fn reihe(id: &str, werte: &[f64]) -> Vec<Value> {
        werte.iter().map(|v| wert(id, id, json!(v))).collect()
    }

    fn roh(features: Vec<Value>) -> Value {
        json!({ "type": "FeatureCollection", "features": features })
    }

    fn fixture() -> Value {
        let mut f = reihe("DEZ0001", &FLENSBURG);
        f.extend(reihe("DEZ3413", &VAHLBERG));
        roh(f)
    }

    // ------------------------------------------------------------------ Berechnung

    #[test]
    fn echte_stichprobe_ergibt_unteres_quartil_und_laesst_duenne_sonde_weg() {
        let g = berechne(&fixture());
        // Nächster Rang: ceil(0,25 × 27) = 7. Aufsteigend: .085 .086 .087 .087 .087 .087 .088
        assert_eq!(g.get("DEZ0001"), Some(&(0.088, 27)));
        assert!(!g.contains_key("DEZ3413"), "10 Werte sind kein Grundpegel");
    }

    #[test]
    fn mindestzahl_ist_zwanzig() {
        let g = berechne(&roh(reihe("A", &[0.1; 19])));
        assert!(g.is_empty(), "19 Werte → kein Pegel");
        let g = berechne(&roh(reihe("A", &[0.1; 20])));
        assert_eq!(g.get("A"), Some(&(0.1, 20)));
    }

    #[test]
    fn quartil_statt_median_widersteht_mehrtaegiger_erhoehung() {
        // 18 von 27 Werten verdreifacht (≈ 4,5 Tage Lage): der Median stünde auf 0,3, das
        // untere Quartil bleibt beim Grundpegel.
        let mut w = vec![0.1; 9];
        w.extend([0.3; 18]);
        assert_eq!(berechne(&roh(reihe("A", &w)))["A"].0, 0.1);
    }

    #[test]
    fn fremde_einheit_und_kaputte_werte_zaehlen_nicht() {
        let mut f = reihe("A", &[0.1; 19]);
        let mut fremd = wert("A", "A", json!(100.0));
        fremd["properties"]["unit"] = json!("nSv/h");
        f.push(fremd);
        f.push(wert("A", "A", Value::Null));
        f.push(wert("A", "A", json!("0.1")));
        assert!(berechne(&roh(f)).is_empty(), "nur 19 gültige Werte");

        let mut f = reihe("B", &[0.1; 19]);
        let mut passend = wert("B", "B", json!(0.1));
        passend["properties"]["unit"] = json!("µSv/h");
        f.push(passend);
        assert_eq!(berechne(&roh(f))["B"].1, 20);
    }

    #[test]
    fn pegel_null_wird_verworfen() {
        assert!(berechne(&roh(reihe("A", &[0.0; 25]))).is_empty());
    }

    #[test]
    fn kennung_faellt_auf_kenn_zurueck() {
        let f: Vec<Value> = (0..20)
            .map(|_| json!({ "properties": { "kenn": "010020006", "value": 0.1 } }))
            .collect();
        assert!(berechne(&roh(f)).contains_key("010020006"));
    }

    #[test]
    fn formatbruch_ergibt_nichts() {
        for r in [json!({}), json!([]), json!({ "features": "x" })] {
            assert!(berechne(&r).is_empty());
        }
    }

    // ------------------------------------------------------------------ Sperrklinke

    fn alt(pegel: f64) -> GrundpegelKarte {
        BTreeMap::from([(
            "A".to_string(),
            Grundpegel {
                pegel,
                n: 27,
                stand: "2026-09-20T12:00:00Z".into(),
            },
        )])
    }

    fn neu(pegel: f64) -> BTreeMap<String, (f64, usize)> {
        BTreeMap::from([("A".to_string(), (pegel, 26))])
    }

    #[test]
    fn mehrtaegige_erhoehung_wandert_nicht_in_den_grundpegel() {
        let k = uebernimm(neu(0.16), &alt(0.1), "2026-09-21T12:00:00Z");
        assert_eq!(k["A"], alt(0.1)["A"], "alter Pegel samt altem Stand");
        // Grenzfall: genau 1,5 × wird ebenfalls verworfen.
        let k = uebernimm(neu(0.15), &alt(0.1), "2026-09-21T12:00:00Z");
        assert_eq!(k["A"].pegel, 0.1);
    }

    #[test]
    fn leichte_verschiebung_und_sinken_werden_uebernommen() {
        for p in [0.12, 0.08] {
            let k = uebernimm(neu(p), &alt(0.1), "2026-09-21T12:00:00Z");
            assert_eq!(
                k["A"],
                Grundpegel {
                    pegel: p,
                    n: 26,
                    stand: "2026-09-21T12:00:00Z".into()
                }
            );
        }
    }

    #[test]
    fn ohne_alten_stand_wird_uebernommen_und_fehlende_sonde_faellt_heraus() {
        let k = uebernimm(neu(0.5), &BTreeMap::new(), "S");
        assert_eq!(k["A"].pegel, 0.5);
        let k = uebernimm(BTreeMap::new(), &alt(0.1), "S");
        assert!(k.is_empty());
    }

    // ------------------------------------------------------------------ Zeitpunkte

    #[test]
    fn zeitpunkte_im_sechs_stunden_raster_innerhalb_von_sieben_tagen() {
        let jetzt = Utc.with_ymd_and_hms(2026, 9, 21, 14, 9, 0).unwrap();
        let t = zeitpunkte(jetzt);
        assert_eq!(
            t.first(),
            Some(&Utc.with_ymd_and_hms(2026, 9, 21, 12, 0, 0).unwrap())
        );
        assert!(t
            .iter()
            .all(|z| z.hour() % 6 == 0 && z.minute() == 0 && z.second() == 0));
        assert!(t.windows(2).all(|p| p[0] - p[1] == Duration::hours(6)));
        // 12:00 − 27 × 6 h = 14.09. 18:00, und das liegt noch nach jetzt − 168 h (14.09. 14:09).
        assert_eq!(t.len(), 28);
        assert_eq!(
            t.last(),
            Some(&Utc.with_ymd_and_hms(2026, 9, 14, 18, 0, 0).unwrap())
        );
    }

    #[test]
    fn zeitpunkte_lassen_die_gerade_abgelaufene_stunde_aus() {
        // 12:30 → jetzt − 1 h = 11:30 → Raster 06:00, nicht 12:00.
        let jetzt = Utc.with_ymd_and_hms(2026, 9, 21, 12, 30, 0).unwrap();
        assert_eq!(zeitpunkte(jetzt)[0].hour(), 6);
    }

    #[test]
    fn zeitpunkte_ausserhalb_des_fensters_fallen_weg() {
        // 06:00 → Start 00:00, der 28. Zeitpunkt (−162 h) liegt GENAU 168 h zurück → raus.
        let jetzt = Utc.with_ymd_and_hms(2026, 9, 21, 6, 0, 0).unwrap();
        assert_eq!(zeitpunkte(jetzt).len(), 27);
        // 07:00 → Start 06:00, der 28. liegt 163 h zurück → drin.
        let jetzt = Utc.with_ymd_and_hms(2026, 9, 21, 7, 0, 0).unwrap();
        assert_eq!(zeitpunkte(jetzt).len(), 28);
    }

    #[test]
    fn cql_filter_listet_die_zeitpunkte() {
        let a = Utc.with_ymd_and_hms(2026, 9, 21, 12, 0, 0).unwrap();
        let b = Utc.with_ymd_and_hms(2026, 9, 21, 6, 0, 0).unwrap();
        assert_eq!(
            cql_filter(&[a, b]),
            "end_measure IN ('2026-09-21T12:00:00Z','2026-09-21T06:00:00Z')"
        );
    }

    // ------------------------------------------------------------------ Bewertung

    fn sonde(kennung: &str, wert: Option<f64>) -> Value {
        let mut p = json!({ "kennung": kennung, "einheit": "µSv/h", "stufe": "normal" });
        if let Some(w) = wert {
            p["wert"] = json!(w);
        }
        json!({ "type": "Feature", "properties": p })
    }

    fn karte(pegel: f64) -> GrundpegelKarte {
        BTreeMap::from([(
            "A".to_string(),
            Grundpegel {
                pegel,
                n: 27,
                stand: "2026-09-21T12:00:00Z".into(),
            },
        )])
    }

    fn bewertet(wert: f64, pegel: f64) -> serde_json::Map<String, Value> {
        let mut fc = json!({ "features": [sonde("A", Some(wert))] });
        bewerte(&mut fc, &karte(pegel));
        fc["features"][0]["properties"].as_object().unwrap().clone()
    }

    #[test]
    fn stufe_aus_dem_faktor_zum_grundpegel() {
        // Spec-Szenarien.
        assert_eq!(bewertet(0.19, 0.06)["stufe"], "stark_erhoeht");
        assert_eq!(bewertet(0.28, 0.2)["stufe"], "normal");
        assert_eq!(bewertet(0.15, 0.1)["stufe"], "normal", "genau 1,5 ×");
        assert_eq!(bewertet(0.3, 0.1)["stufe"], "erhoeht", "genau 3 ×");
        assert_eq!(bewertet(0.151, 0.1)["stufe"], "erhoeht");
        assert_eq!(bewertet(0.301, 0.1)["stufe"], "stark_erhoeht");
        // Hier rundet das PRODUKT nach unten (1,5 × 0,072 = 0,10799…, 3 × 0,071 = 0,21299…):
        // ohne Toleranz fiele „genau 1,5 ×" bzw. „genau 3 ×" in die obere Stufe.
        assert_eq!(
            bewertet(0.108, 0.072)["stufe"],
            "normal",
            "genau 1,5 × 0,072"
        );
        assert_eq!(
            bewertet(0.213, 0.071)["stufe"],
            "erhoeht",
            "genau 3 × 0,071"
        );
    }

    #[test]
    fn standort_traegt_grundpegel_faktor_und_stand() {
        let p = bewertet(0.19, 0.06);
        // Wire-Pin: das Wort ist Vertrag zu `OdlBewertung` im Frontend.
        assert_eq!(p["bewertung"], "standort");
        assert_eq!(p["grundpegel"], 0.06);
        assert_eq!(p["faktor"], 3.17);
        assert_eq!(p["grundpegel_stand"], "2026-09-21T12:00:00Z");
    }

    #[test]
    fn ohne_grundpegel_bleibt_die_absolute_stufe_und_die_felder_fehlen() {
        let mut kein_pegel = sonde("B", Some(0.7));
        kein_pegel["properties"]["stufe"] = json!("stark_erhoeht");
        let kein_wert = {
            let mut s = sonde("A", None);
            s["properties"]["stufe"] = json!("keine_messung");
            s
        };
        let mut fremd = sonde("A", Some(100.0));
        fremd["properties"]["einheit"] = json!("nSv/h");
        fremd["properties"]["stufe"] = json!("keine_messung");
        let mut fc = json!({ "features": [kein_pegel, kein_wert, fremd] });
        bewerte(&mut fc, &karte(0.1));
        for (i, stufe) in [
            (0, "stark_erhoeht"),
            (1, "keine_messung"),
            (2, "keine_messung"),
        ] {
            let p = fc["features"][i]["properties"].as_object().unwrap();
            // Wire-Pin.
            assert_eq!(p["bewertung"], "absolut", "Feature {i}");
            assert_eq!(p["stufe"], stufe, "Feature {i}");
            // Presence statt `== Null` (CLAUDE.md, Typ-Codegen-Testfalle).
            for feld in ["grundpegel", "faktor", "grundpegel_stand"] {
                assert!(!p.contains_key(feld), "Feature {i}: {feld} muss fehlen");
            }
        }
    }

    #[test]
    fn bewertung_uebersteht_formatbruch() {
        let mut v = json!({});
        bewerte(&mut v, &karte(0.1));
        assert_eq!(v, json!({}));
    }

    #[test]
    fn iso_utc_ist_sekundengenau_mit_z() {
        let t = Utc.with_ymd_and_hms(2026, 1, 2, 3, 4, 5).unwrap();
        assert_eq!(iso_utc(t), "2026-01-02T03:04:05Z");
    }
}
