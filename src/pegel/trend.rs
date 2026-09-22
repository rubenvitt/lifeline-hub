//! Reine Auswertung einer PEGELONLINE-Zeitreihe (LFH-606): Parsen, jüngste Messung, Trend.
//!
//! **Warum Regression statt Differenz:** „jetzt minus vor einer Stunde" hängt an genau zwei
//! Messungen; ein einzelner Ausreißer an einer der beiden schlägt voll auf den Trend durch
//! und kann die Richtung umdrehen. Die Kleinste-Quadrate-Steigung verteilt sein Gewicht auf
//! alle Punkte im Fenster. Immun ist sie nicht — ein Ausreißer am Fensterrand hat die
//! größte Hebelwirkung —, aber gedämpft, und die Dämpfung wächst mit der Punktdichte.

use chrono::{DateTime, FixedOffset};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::PegelMessung;

/// Länge des Trendfensters vor der jüngsten Messung (Sekunden).
pub const FENSTER_S: i64 = 60 * 60;
/// Mindestspanne der Messungen im Fenster, ab der ein Trend ausgewiesen wird (Sekunden).
pub const MIN_SPANNE_S: i64 = 30 * 60;

/// Ein Messpunkt, wie er im Cache (`pegel:<uuid>`) liegt. Der Zeitstempel bleibt der
/// Originalstring der Quelle, damit die Anzeige den Zonenversatz der Quelle behält.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Messpunkt {
    pub zeitpunkt: String,
    pub wert_cm: f64,
}

/// `measurements.json` → Messpunkte. `None`, wenn die Antwort kein Array ist (z. B. der
/// 404-Körper `{"status":404,…}` einer unbekannten Station). Einträge ohne gültigen
/// RFC-3339-Zeitstempel oder ohne endlichen Zahlwert werden übersprungen. Ein leeres Array
/// ist eine gültige Antwort (Station ohne Messung im Abrufzeitraum).
pub fn parse_messungen(roh: &Value) -> Option<Vec<Messpunkt>> {
    let arr = roh.as_array()?;
    Some(
        arr.iter()
            .filter_map(|m| {
                let zeitpunkt = m.get("timestamp")?.as_str()?;
                let wert_cm = m.get("value")?.as_f64()?;
                if !wert_cm.is_finite() || DateTime::parse_from_rfc3339(zeitpunkt).is_err() {
                    return None;
                }
                Some(Messpunkt {
                    zeitpunkt: zeitpunkt.to_string(),
                    wert_cm,
                })
            })
            .collect(),
    )
}

fn zeit(p: &Messpunkt) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(&p.zeitpunkt).ok()
}

/// Jüngste Messung samt Trend. `None` bei leerer (oder gänzlich unlesbarer) Reihe.
/// Die Reihenfolge der Eingabe ist egal — maßgeblich ist der absolute Zeitpunkt.
pub fn messung_aus_reihe(reihe: &[Messpunkt]) -> Option<PegelMessung> {
    let punkte: Vec<(i64, f64, &Messpunkt)> = reihe
        .iter()
        .filter_map(|p| zeit(p).map(|t| (t.timestamp(), p.wert_cm, p)))
        .collect();
    let (_, wert, juengste) = punkte.iter().max_by_key(|(t, _, _)| *t)?;
    let zeitreihe: Vec<(i64, f64)> = punkte.iter().map(|(t, v, _)| (*t, *v)).collect();
    Some(PegelMessung {
        wasserstand_cm: *wert,
        zeitpunkt: juengste.zeitpunkt.clone(),
        trend_cm_pro_h: trend_cm_pro_h(&zeitreihe),
    })
}

/// Trend in cm/h über `(unix_sekunden, wert_cm)`: Kleinste-Quadrate-Steigung über alle
/// Punkte in `[t_max − 60 min, t_max]`, auf eine Nachkommastelle gerundet.
///
/// `None`, wenn weniger als zwei Punkte im Fenster liegen oder die Punkte im Fenster weniger
/// als 30 min überspannen — eine Steigung aus zwei Punkten im Minutenabstand wäre Rauschen.
pub fn trend_cm_pro_h(punkte: &[(i64, f64)]) -> Option<f64> {
    let t_max = punkte.iter().map(|(t, _)| *t).max()?;
    let fenster: Vec<(i64, f64)> = punkte
        .iter()
        .copied()
        .filter(|(t, v)| *t >= t_max - FENSTER_S && v.is_finite())
        .collect();
    if fenster.len() < 2 {
        return None;
    }
    let t_min = fenster.iter().map(|(t, _)| *t).min()?;
    if t_max - t_min < MIN_SPANNE_S {
        return None;
    }
    let n = fenster.len() as f64;
    // x in Stunden relativ zur jüngsten Messung — kleine Zahlen, keine Auslöschung.
    let xs: Vec<f64> = fenster
        .iter()
        .map(|(t, _)| (t - t_max) as f64 / 3600.0)
        .collect();
    let mx = xs.iter().sum::<f64>() / n;
    let my = fenster.iter().map(|(_, v)| v).sum::<f64>() / n;
    let (mut sxx, mut sxy) = (0.0, 0.0);
    for (x, (_, y)) in xs.iter().zip(&fenster) {
        sxx += (x - mx) * (x - mx);
        sxy += (x - mx) * (y - my);
    }
    if sxx <= 0.0 {
        return None;
    }
    let gerundet = (sxy / sxx * 10.0).round() / 10.0;
    // −0.0 käme als "-0.0" auf den Draht; gleichbleibend ist 0.
    Some(if gerundet == 0.0 { 0.0 } else { gerundet })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Reihe im Raster `schritt_min`: `werte[i]` liegt `(n-1-i) * schritt_min` min vor einem
    /// festen Endzeitpunkt.
    fn raster(werte: &[f64], schritt_min: i64) -> Vec<(i64, f64)> {
        let ende = 1_790_000_000_i64; // beliebiger fester Zeitpunkt
        let n = werte.len() as i64;
        werte
            .iter()
            .enumerate()
            .map(|(i, v)| (ende - (n - 1 - i as i64) * schritt_min * 60, *v))
            .collect()
    }

    /// Naive Referenz, gegen die die Regression antritt: letzter minus erster Punkt im
    /// 60-min-Fenster, je Stunde.
    fn differenz(punkte: &[(i64, f64)]) -> f64 {
        let t_max = punkte.iter().map(|p| p.0).max().unwrap();
        let im_fenster: Vec<_> = punkte
            .iter()
            .filter(|(t, _)| *t >= t_max - FENSTER_S)
            .collect();
        let erster = im_fenster.iter().min_by_key(|p| p.0).unwrap();
        let letzter = im_fenster.iter().max_by_key(|p| p.0).unwrap();
        (letzter.1 - erster.1) / ((letzter.0 - erster.0) as f64 / 3600.0)
    }

    #[test]
    fn steigend() {
        // +2,5 cm je 15 min = +10 cm/h.
        let p = raster(&[100.0, 102.5, 105.0, 107.5, 110.0], 15);
        assert_eq!(trend_cm_pro_h(&p), Some(10.0));
    }

    #[test]
    fn fallend() {
        let p = raster(&[300.0, 298.0, 296.0, 294.0, 292.0], 15);
        assert_eq!(trend_cm_pro_h(&p), Some(-8.0));
    }

    #[test]
    fn konstant_ist_null_ohne_vorzeichen() {
        let p = raster(&[63.0, 63.0, 63.0, 63.0, 63.0], 15);
        let t = trend_cm_pro_h(&p).unwrap();
        assert_eq!(t, 0.0);
        assert!(t.is_sign_positive(), "kein -0.0 auf dem Draht");
    }

    #[test]
    fn rundet_auf_eine_nachkommastelle() {
        // Ungerundete Steigung: 2,575 / 0,625 = 4,12 cm/h.
        let p = raster(&[100.0, 101.0, 102.0, 103.1, 104.1], 15);
        assert_eq!(trend_cm_pro_h(&p), Some(4.1));
    }

    #[test]
    fn zu_wenig_punkte() {
        assert_eq!(trend_cm_pro_h(&[]), None);
        assert_eq!(trend_cm_pro_h(&raster(&[100.0], 15)), None);
        // Zwei Punkte, aber der ältere liegt außerhalb des 60-min-Fensters: im Fenster bleibt
        // nur einer.
        assert_eq!(trend_cm_pro_h(&raster(&[90.0, 100.0], 75)), None);
    }

    #[test]
    fn zu_kurzes_fenster() {
        // Drei Punkte über 20 min — genug Punkte, aber keine 30 min Spanne.
        assert_eq!(trend_cm_pro_h(&raster(&[100.0, 101.0, 102.0], 10)), None);
        // Genau 30 min reichen.
        assert_eq!(
            trend_cm_pro_h(&raster(&[100.0, 101.0, 102.0], 15)),
            Some(4.0)
        );
    }

    #[test]
    fn aeltere_punkte_ausserhalb_des_fensters_zaehlen_nicht() {
        // Drei Stunden Reihe: erst stark fallend, in der letzten Stunde steigend.
        let mut werte = vec![200.0, 180.0, 160.0, 140.0, 120.0, 100.0, 80.0, 60.0];
        werte.extend([60.0, 62.5, 65.0, 67.5, 70.0]);
        let p = raster(&werte, 15);
        assert_eq!(trend_cm_pro_h(&p), Some(10.0));
    }

    #[test]
    fn ausreisser_am_bezugspunkt_dreht_die_differenz_um_die_regression_nicht() {
        // Saubere Rampe +10 cm/h im 5-min-Raster, der Bezugspunkt „vor einer Stunde" ist ein
        // einzelner Ausreißer (+15 cm, etwa Wellenschlag am Sensor).
        let mut werte: Vec<f64> = (0..13).map(|i| 100.0 + i as f64 * 10.0 / 12.0).collect();
        werte[0] += 15.0;
        let p = raster(&werte, 5);
        let naiv = differenz(&p);
        let reg = trend_cm_pro_h(&p).unwrap();
        assert!(naiv < 0.0, "die Differenz meldet fallend: {naiv}");
        assert!(reg > 0.0, "die Regression bleibt steigend: {reg}");
        assert!((reg - 10.0).abs() < (naiv - 10.0).abs());
    }

    #[test]
    fn ausreisser_im_15_min_raster_wird_gedaempft() {
        // Im 15-min-Raster (fünf Punkte) ist die Dämpfung am Fensterrand schwächer — aber
        // die Regression liegt trotzdem näher an der Wahrheit als die Differenz.
        let mut werte = vec![100.0, 102.5, 105.0, 107.5, 110.0];
        werte[4] -= 8.0; // Ausreißer an der jüngsten Messung
        let p = raster(&werte, 15);
        let naiv = differenz(&p);
        let reg = trend_cm_pro_h(&p).unwrap();
        assert!((reg - 10.0).abs() < (naiv - 10.0).abs(), "{reg} vs {naiv}");
    }

    #[test]
    fn messung_mit_zonenversatz_und_unsortierter_reihe() {
        // PEGELONLINE liefert Ortszeit mit Versatz. 09:15+02:00 ist 07:15Z — jünger als
        // 07:00Z. Würde der Versatz verworfen, läge die „jüngste" Messung falsch und der
        // Trend kippte ins Negative.
        let roh = json!([
            { "timestamp": "2026-09-22T09:15:00+02:00", "value": 110.0 },
            { "timestamp": "2026-09-22T06:15:00Z", "value": 100.0 },
            { "timestamp": "2026-09-22T06:45:00Z", "value": 105.0 },
            { "timestamp": "2026-09-22T07:00:00Z", "value": 107.5 },
            { "timestamp": "2026-09-22T08:30:00+02:00", "value": 102.5 },
        ]);
        let reihe = parse_messungen(&roh).unwrap();
        let m = messung_aus_reihe(&reihe).unwrap();
        assert_eq!(m.wasserstand_cm, 110.0);
        assert_eq!(m.zeitpunkt, "2026-09-22T09:15:00+02:00");
        assert_eq!(m.trend_cm_pro_h, Some(10.0));
    }

    #[test]
    fn parse_verwirft_unbrauchbares_und_erkennt_404_koerper() {
        assert!(parse_messungen(&json!({"status": 404, "message": "x"})).is_none());
        let reihe = parse_messungen(&json!([
            { "timestamp": "kaputt", "value": 1.0 },
            { "timestamp": "2026-09-22T09:15:00+02:00" },
            { "value": 3.0 },
            { "timestamp": "2026-09-22T09:30:00+02:00", "value": 63.0 },
        ]))
        .unwrap();
        assert_eq!(reihe.len(), 1);
        assert_eq!(reihe[0].wert_cm, 63.0);
        assert_eq!(parse_messungen(&json!([])), Some(vec![]));
    }

    #[test]
    fn leere_reihe_hat_keine_messung() {
        assert_eq!(messung_aus_reihe(&[]), None);
    }

    #[test]
    fn einzelne_messung_ohne_trend() {
        let m = messung_aus_reihe(&[Messpunkt {
            zeitpunkt: "2026-09-22T09:15:00+02:00".into(),
            wert_cm: 63.0,
        }])
        .unwrap();
        assert_eq!(m.trend_cm_pro_h, None);
    }
}
