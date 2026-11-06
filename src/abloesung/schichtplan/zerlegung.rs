//! Zeitregeln eines Blocks und „Schichten erzeugen“ (LLH-1552, design.md D3 und D6). Rein.
//!
//! - [`pruefe_zeitraum`]: volle 5 Minuten ohne Sekunden, 10 min bis 24 h (400).
//! - [`zerlege`]: einen Zeitraum in Blöcke teilen, mit einer Länge oder nach dem Schichtmodell des
//!   Einsatzes (Rhythmus oder Wechselzeiten in der Zone des Einsatzes, über
//!   [`faelligkeit_wechselzeiten`], so bleibt die Zeitumstellung richtig). Ein Rest unter 10 min
//!   wird dem Nachbarn zugeschlagen. Mehr als [`ERZEUGEN_MAX`] Blöcke sind 400; ein Modell, das
//!   Blöcke außerhalb des Rasters oder über 24 h ergäbe, ist 422.

use chrono::{DateTime, Duration, Timelike, Utc};
use chrono_tz::Tz;

use super::{BLOCK_MAX_MINUTEN, BLOCK_MIN_MINUTEN, ERZEUGEN_MAX, RASTER_MINUTEN};
use crate::error::AppError;
use crate::schichtmodell::{faelligkeit_wechselzeiten, Regel};

/// Ob ein Zeitpunkt auf vollen 5 Minuten ohne Sekunden liegt (in UTC; in jeder Zone mit Versatz
/// in Viertelstunden dasselbe Raster).
pub fn im_raster(t: DateTime<Utc>) -> bool {
    t.second() == 0 && t.nanosecond() == 0 && i64::from(t.minute()) % RASTER_MINUTEN == 0
}

/// Feldprüfung eines Zeitraums (400): Raster, Mindest- und Höchstlänge.
pub fn pruefe_zeitraum(von: DateTime<Utc>, bis: DateTime<Utc>) -> Result<(), AppError> {
    if !im_raster(von) || !im_raster(bis) {
        return Err(AppError::Validation(format!(
            "Beginn und Ende liegen auf vollen {RASTER_MINUTEN} Minuten"
        )));
    }
    let minuten = (bis - von).num_minutes();
    if minuten < BLOCK_MIN_MINUTEN {
        return Err(AppError::Validation(format!(
            "Eine Schicht dauert mindestens {BLOCK_MIN_MINUTEN} Minuten"
        )));
    }
    if minuten > BLOCK_MAX_MINUTEN {
        return Err(AppError::Validation(
            "Eine Schicht dauert höchstens 24 Stunden".into(),
        ));
    }
    Ok(())
}

/// Wie ein Zeitraum geteilt wird.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Teilung {
    /// Gleich lange Blöcke in Minuten (Feld `laenge_minuten`).
    Laenge(i64),
    /// Nach dem Schichtmodell des Einsatzes.
    Modell { regel: Regel, zone: Tz },
}

/// Feldprüfung einer Länge (400): Raster, 10 min bis 24 h.
pub fn pruefe_laenge(minuten: i64) -> Result<i64, AppError> {
    if !(BLOCK_MIN_MINUTEN..=BLOCK_MAX_MINUTEN).contains(&minuten) || minuten % RASTER_MINUTEN != 0
    {
        return Err(AppError::Validation(format!(
            "laenge_minuten: {BLOCK_MIN_MINUTEN} bis {BLOCK_MAX_MINUTEN} in Schritten von \
             {RASTER_MINUTEN}"
        )));
    }
    Ok(minuten)
}

/// Teilt `[von, bis)` in Blöcke. `von` und `bis` sind schon geprüft (Raster, `bis - von` ab 10
/// min, beliebig lang). Der letzte Block endet bei `bis`.
pub fn zerlege(
    von: DateTime<Utc>,
    bis: DateTime<Utc>,
    teilung: &Teilung,
) -> Result<Vec<(DateTime<Utc>, DateTime<Utc>)>, AppError> {
    let mut grenzen = vec![von];
    let mut aktuell = von;
    while aktuell < bis {
        if grenzen.len() > ERZEUGEN_MAX + 1 {
            return Err(zu_viele());
        }
        let naechste = match teilung {
            Teilung::Laenge(m) => aktuell + Duration::minutes(*m),
            Teilung::Modell {
                regel: Regel::Rhythmus { minuten },
                ..
            } => aktuell + Duration::minutes(*minuten),
            Teilung::Modell {
                regel:
                    Regel::Wechselzeiten {
                        zeiten,
                        mindestdauer_minuten,
                    },
                zone,
            } => faelligkeit_wechselzeiten(aktuell, zeiten, *mindestdauer_minuten, *zone)
                .unwrap_or(bis),
        };
        aktuell = naechste.min(bis);
        grenzen.push(aktuell);
    }

    // Ein zu kurzer Block geht im Nachbarn auf: der letzte im vorletzten, ein anderer im
    // folgenden (bei Wechselzeiten kann der erste kurz sein, wenn der Zeitraum knapp vor einem
    // Wechsel beginnt).
    let min = Duration::minutes(BLOCK_MIN_MINUTEN);
    let mut i = 1;
    while i < grenzen.len() {
        let kurz = grenzen[i] - grenzen[i - 1] < min;
        if kurz && grenzen.len() > 2 {
            if i == grenzen.len() - 1 {
                grenzen.remove(i - 1);
            } else {
                grenzen.remove(i);
            }
            continue;
        }
        i += 1;
    }

    let bloecke: Vec<_> = grenzen.windows(2).map(|w| (w[0], w[1])).collect();
    if bloecke.len() > ERZEUGEN_MAX {
        return Err(zu_viele());
    }
    for (a, b) in &bloecke {
        if !im_raster(*a) || !im_raster(*b) {
            return Err(AppError::UnprocessableEntity(format!(
                "Die Wechselzeiten des Schichtmodells liegen nicht auf vollen {RASTER_MINUTEN} \
                 Minuten; bitte eine Länge angeben"
            )));
        }
        if (*b - *a).num_minutes() > BLOCK_MAX_MINUTEN {
            return Err(AppError::UnprocessableEntity(
                "Das Schichtmodell ergibt Schichten über 24 Stunden; bitte eine Länge angeben"
                    .into(),
            ));
        }
    }
    Ok(bloecke)
}

fn zu_viele() -> AppError {
    AppError::Validation(format!(
        "Höchstens {ERZEUGEN_MAX} Schichten auf einmal; bitte den Zeitraum kürzen"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::uhrzeit::Uhrzeit;

    fn utc(s: &str) -> DateTime<Utc> {
        crate::zeit::parse_utc(s).unwrap()
    }

    fn texte(bloecke: &[(DateTime<Utc>, DateTime<Utc>)]) -> Vec<String> {
        bloecke
            .iter()
            .map(|(a, b)| format!("{}–{}", a.format("%d. %H:%M"), b.format("%d. %H:%M")))
            .collect()
    }

    fn wechsel(zeiten: &[&str], mindestdauer: i64) -> Teilung {
        Teilung::Modell {
            regel: Regel::Wechselzeiten {
                zeiten: zeiten
                    .iter()
                    .map(|z| Uhrzeit::parse("t", z).unwrap())
                    .collect(),
                mindestdauer_minuten: mindestdauer,
            },
            zone: chrono_tz::Europe::Berlin,
        }
    }

    #[test]
    fn zeitraum_raster_und_laenge() {
        assert!(pruefe_zeitraum(utc("2026-11-07 14:00:00"), utc("2026-11-07 14:10:00")).is_ok());
        for (a, b) in [
            ("2026-11-07 14:02:00", "2026-11-07 15:00:00"),
            ("2026-11-07 14:00:30", "2026-11-07 15:00:00"),
            ("2026-11-07 14:00:00", "2026-11-07 14:05:00"),
            ("2026-11-07 14:00:00", "2026-11-08 14:05:00"),
        ] {
            assert!(matches!(
                pruefe_zeitraum(utc(a), utc(b)),
                Err(AppError::Validation(_))
            ));
        }
        assert!(pruefe_zeitraum(utc("2026-11-07 14:00:00"), utc("2026-11-08 14:00:00")).is_ok());
        assert!(pruefe_laenge(120).is_ok());
        for falsch in [5, 12, 1445] {
            assert!(pruefe_laenge(falsch).is_err());
        }
    }

    /// Szenario „Eigene Länge“: 18:00–00:00 mit 2 h ergibt drei Blöcke (UTC wie Ortszeit egal).
    #[test]
    fn eigene_laenge() {
        let b = zerlege(
            utc("2026-11-07 17:00:00"),
            utc("2026-11-07 23:00:00"),
            &Teilung::Laenge(120),
        )
        .unwrap();
        assert_eq!(
            texte(&b),
            [
                "07. 17:00–07. 19:00",
                "07. 19:00–07. 21:00",
                "07. 21:00–07. 23:00"
            ]
        );
    }

    /// Ein Rest unter 10 min geht im vorletzten Block auf; ein längerer Rest bleibt eigen.
    #[test]
    fn kurzer_rest_wird_zugeschlagen() {
        let b = zerlege(
            utc("2026-11-07 14:00:00"),
            utc("2026-11-07 18:05:00"),
            &Teilung::Laenge(120),
        )
        .unwrap();
        assert_eq!(texte(&b), ["07. 14:00–07. 16:00", "07. 16:00–07. 18:05"]);
        let b = zerlege(
            utc("2026-11-07 14:00:00"),
            utc("2026-11-07 18:10:00"),
            &Teilung::Laenge(120),
        )
        .unwrap();
        assert_eq!(b.len(), 3);
        let b = zerlege(
            utc("2026-11-07 14:00:00"),
            utc("2026-11-07 14:15:00"),
            &Teilung::Laenge(120),
        )
        .unwrap();
        assert_eq!(texte(&b), ["07. 14:00–07. 14:15"]);
    }

    /// Szenario „Wechselzeiten“: 06/14/22 Uhr (Ortszeit), Mindestdauer 4 h, UHS 10:00–23:00.
    #[test]
    fn wechselzeiten_in_der_zone() {
        // 7.11.2026: Berlin = UTC+1.
        let b = zerlege(
            utc("2026-11-07 09:00:00"),
            utc("2026-11-07 22:00:00"),
            &wechsel(&["06:00", "14:00", "22:00"], 240),
        )
        .unwrap();
        assert_eq!(
            texte(&b),
            [
                "07. 09:00–07. 13:00",
                "07. 13:00–07. 21:00",
                "07. 21:00–07. 22:00"
            ]
        );
    }

    /// Über die Zeitumstellung (25.10.2026) zählt die Wanduhr: 18:00 → 06:00 Ortszeit sind 13 h.
    #[test]
    fn wechselzeiten_ueber_die_zeitumstellung() {
        let b = zerlege(
            utc("2026-10-24 16:00:00"),
            utc("2026-10-25 17:00:00"),
            &wechsel(&["06:00", "18:00"], 0),
        )
        .unwrap();
        assert_eq!(
            texte(&b),
            ["24. 16:00–25. 05:00", "25. 05:00–25. 17:00"],
            "erster Block 13 h, zweiter 12 h"
        );
    }

    #[test]
    fn rhythmus_und_grenzen() {
        let b = zerlege(
            utc("2026-11-07 06:00:00"),
            utc("2026-11-08 06:00:00"),
            &Teilung::Modell {
                regel: Regel::Rhythmus { minuten: 480 },
                zone: chrono_tz::Europe::Berlin,
            },
        )
        .unwrap();
        assert_eq!(b.len(), 3);
        // Über 24 h je Block → 422.
        let zu_lang = zerlege(
            utc("2026-11-07 06:00:00"),
            utc("2026-11-09 06:00:00"),
            &Teilung::Modell {
                regel: Regel::Rhythmus { minuten: 2880 },
                zone: chrono_tz::Europe::Berlin,
            },
        );
        assert!(matches!(zu_lang, Err(AppError::UnprocessableEntity(_))));
        // Mehr als 100 Blöcke → 400.
        let viele = zerlege(
            utc("2026-11-07 00:00:00"),
            utc("2026-11-08 00:00:00"),
            &Teilung::Laenge(10),
        );
        assert!(matches!(viele, Err(AppError::Validation(_))));
        // Genau 100 geht.
        let hundert = zerlege(
            utc("2026-11-07 00:00:00"),
            utc("2026-11-07 16:40:00"),
            &Teilung::Laenge(10),
        )
        .unwrap();
        assert_eq!(hundert.len(), 100);
        // Wechselzeit außerhalb des Rasters → 422.
        let schief = zerlege(
            utc("2026-11-07 06:00:00"),
            utc("2026-11-07 20:00:00"),
            &wechsel(&["12:07"], 0),
        );
        assert!(matches!(schief, Err(AppError::UnprocessableEntity(_))));
    }
}
