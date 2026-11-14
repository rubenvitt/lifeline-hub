//! Backoff und Anhalten als reine Funktion (LLH-1656, design.md D6, Spec `webhook-zustellung`,
//! „Wiederholung mit Backoff“ und „Nach 24 Stunden ohne Erfolg wird angehalten“).
//!
//! Wartezeit nach dem n-ten Fehlschlag in Folge: `min(60 s · 2^(n−1), 6 h)`. Fiele der nächste
//! Versuch hinter `fehler_seit + 24 h`, liegt er genau dort; scheitert er, wird angehalten.

use chrono::Duration;

use crate::zeit;

/// Erste Wartezeit nach einem Fehlschlag.
pub const WARTEZEIT_START_S: i64 = 60;

/// Längste Wartezeit zwischen zwei Versuchen.
pub const WARTEZEIT_MAX_S: i64 = 6 * 60 * 60;

/// Nach so langer Störung ohne Erfolg wird angehalten.
pub const ANHALTEN_NACH_S: i64 = 24 * 60 * 60;

/// Wartezeit nach dem `fehlversuche`-ten Fehlschlag in Folge (ab 1).
pub fn wartezeit_s(fehlversuche: i64) -> i64 {
    let n = fehlversuche.clamp(1, 64);
    // 60 · 2^(n−1), ohne Überlauf: ab 2^9 liegt es ohnehin über der Obergrenze.
    let faktor = 1_i64 << (n - 1).min(20);
    WARTEZEIT_START_S
        .saturating_mul(faktor)
        .min(WARTEZEIT_MAX_S)
}

/// Was nach einem Fehlschlag gilt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NachFehlschlag {
    /// Erneut versuchen.
    Wiederholen {
        fehler_seit: String,
        fehlversuche: i64,
        naechster_versuch_at: String,
    },
    /// 24 h ohne Erfolg: anhalten.
    Anhalten {
        fehler_seit: String,
        fehlversuche: i64,
    },
}

/// Der Zustand nach einem Fehlschlag um `jetzt` (`zeit::FORMAT`). `fehler_seit` ist der erste
/// Fehlschlag der laufenden Störung, `None` beim ersten.
pub fn nach_fehlschlag(
    fehler_seit: Option<&str>,
    fehlversuche_bisher: i64,
    jetzt: &str,
) -> NachFehlschlag {
    let jetzt_t = zeit::parse(jetzt).expect("jetzt im Format zeit::FORMAT");
    let seit = fehler_seit.unwrap_or(jetzt).to_string();
    let seit_t = zeit::parse(&seit).unwrap_or(jetzt_t);
    let fehlversuche = fehlversuche_bisher.max(0) + 1;
    let frist = seit_t + Duration::seconds(ANHALTEN_NACH_S);
    if jetzt_t >= frist {
        return NachFehlschlag::Anhalten {
            fehler_seit: seit,
            fehlversuche,
        };
    }
    let naechster = (jetzt_t + Duration::seconds(wartezeit_s(fehlversuche))).min(frist);
    NachFehlschlag::Wiederholen {
        fehler_seit: seit,
        fehlversuche,
        naechster_versuch_at: zeit::formatiere(naechster),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wartezeiten_verdoppeln_bis_sechs_stunden() {
        let minuten: Vec<i64> = (1..=11).map(|n| wartezeit_s(n) / 60).collect();
        assert_eq!(minuten, [1, 2, 4, 8, 16, 32, 64, 128, 256, 360, 360]);
        assert_eq!(wartezeit_s(1000), WARTEZEIT_MAX_S);
        assert_eq!(wartezeit_s(0), WARTEZEIT_START_S);
    }

    #[test]
    fn erster_fehlschlag_setzt_fehler_seit_und_eine_minute() {
        assert_eq!(
            nach_fehlschlag(None, 0, "2026-11-13 10:00:00"),
            NachFehlschlag::Wiederholen {
                fehler_seit: "2026-11-13 10:00:00".into(),
                fehlversuche: 1,
                naechster_versuch_at: "2026-11-13 10:01:00".into(),
            }
        );
    }

    /// Spielt eine Störung durch, in der jeder Versuch pünktlich kommt und scheitert, und liefert
    /// die Zeitpunkte der Versuche und den des Anhaltens.
    fn durchspielen(start: &str) -> (Vec<String>, String) {
        let mut versuche = vec![start.to_string()];
        let mut seit: Option<String> = None;
        let mut n = 0;
        let mut jetzt = start.to_string();
        loop {
            match nach_fehlschlag(seit.as_deref(), n, &jetzt) {
                NachFehlschlag::Wiederholen {
                    fehler_seit,
                    fehlversuche,
                    naechster_versuch_at,
                } => {
                    seit = Some(fehler_seit);
                    n = fehlversuche;
                    jetzt = naechster_versuch_at;
                    versuche.push(jetzt.clone());
                }
                NachFehlschlag::Anhalten { .. } => return (versuche, jetzt),
            }
        }
    }

    #[test]
    fn zwei_stunden_weg_naechster_versuch_nach_127_minuten() {
        let (versuche, _) = durchspielen("2026-11-13 10:00:00");
        // 0, 1, 3, 7, 15, 31, 63, 127 min: der erste Versuch nach 2 h liegt bei 12:07.
        assert_eq!(
            &versuche[..8],
            [
                "2026-11-13 10:00:00",
                "2026-11-13 10:01:00",
                "2026-11-13 10:03:00",
                "2026-11-13 10:07:00",
                "2026-11-13 10:15:00",
                "2026-11-13 10:31:00",
                "2026-11-13 11:03:00",
                "2026-11-13 12:07:00",
            ]
        );
    }

    #[test]
    fn angehalten_genau_nach_24_stunden_und_nie_mehr_als_sechs_stunden_pause() {
        let (versuche, angehalten) = durchspielen("2026-11-13 10:00:00");
        assert_eq!(angehalten, "2026-11-14 10:00:00");
        assert_eq!(versuche.last().unwrap(), "2026-11-14 10:00:00");
        for paar in versuche.windows(2) {
            let a = zeit::parse(&paar[0]).unwrap();
            let b = zeit::parse(&paar[1]).unwrap();
            assert!((b - a).num_seconds() <= WARTEZEIT_MAX_S, "{paar:?}");
            assert!(b > a, "{paar:?}");
        }
    }

    #[test]
    fn spaeter_versuch_nach_der_frist_haelt_an() {
        // Der Lauf kam (etwa nach einem Neustart) erst 25 h nach dem ersten Fehlschlag dran.
        assert_eq!(
            nach_fehlschlag(Some("2026-11-13 10:00:00"), 5, "2026-11-14 11:00:00"),
            NachFehlschlag::Anhalten {
                fehler_seit: "2026-11-13 10:00:00".into(),
                fehlversuche: 6,
            }
        );
    }
}
