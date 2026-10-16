//! Uhrzeit ohne Datum und ohne Zone (LLH-1058, design.md D2): eine Wanduhrzeit `HH:MM` wie der
//! Beginn einer Mahlzeit im Verpflegungsplan („Frühstück 06:30“). Erst das Anwenden auf einen
//! Kalendertag macht daraus einen Zeitpunkt, und das geschieht in der Anzeigezone im Client
//! (Spec `zeiteingabe`, „Uhrzeit ohne Datum“), nicht hier.
//!
//! Bewusst getrennt von [`crate::zeit`]: dort gilt das eine Zeitformat für Zeitpunkte (UTC,
//! sekundengenau). Eine Uhrzeit ist kein Zeitpunkt. Gespeichert und gesendet wird `HH:MM`; als
//! Text sortiert das richtig, die Ordnung des Typs ist dieselbe.
//!
//! Gelesen werden „HH:MM“ und die Stab-Schreibweise „HHMM“, getrimmt, von 00:00 bis 23:59. Die
//! kurzen Formen „HMM“ und „H:MM“ ergänzt erst die Maske (`frontend/src/anzeige/uhrzeit.ts`) zu
//! „HH:MM“; der Server nimmt nur, was die Maske sendet.

use std::fmt;

use crate::error::AppError;

/// Eine Wanduhrzeit. Die Ordnung ist die des Tages: Stunde, dann Minute.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Uhrzeit {
    stunde: u8,
    minute: u8,
}

impl Uhrzeit {
    /// Liest „HH:MM“ oder „HHMM“ (getrimmt, 00:00–23:59). Alles andere ist ein Feldfehler (400)
    /// mit dem Feldnamen.
    pub fn parse(feld: &str, s: &str) -> Result<Uhrzeit, AppError> {
        let t = s.trim();
        let ziffern: Option<[u8; 4]> = match t.as_bytes() {
            [a, b, b':', c, d] | [a, b, c, d] => Some([*a, *b, *c, *d]),
            _ => None,
        };
        ziffern
            .filter(|z| z.iter().all(u8::is_ascii_digit))
            .map(|z| Uhrzeit {
                stunde: (z[0] - b'0') * 10 + (z[1] - b'0'),
                minute: (z[2] - b'0') * 10 + (z[3] - b'0'),
            })
            .filter(|u| u.stunde < 24 && u.minute < 60)
            .ok_or_else(|| {
                AppError::Validation(format!(
                    "{feld}: ungültige Uhrzeit '{s}' (erwartet: HH:MM oder HHMM, 00:00 bis 23:59)"
                ))
            })
    }

    pub const fn stunde(self) -> u8 {
        self.stunde
    }

    pub const fn minute(self) -> u8 {
        self.minute
    }
}

/// `HH:MM`, die Form in Datenbank und Wire.
impl fmt::Display for Uhrzeit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:02}:{:02}", self.stunde, self.minute)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;

    fn text(s: &str) -> String {
        Uhrzeit::parse("beginn", s).unwrap().to_string()
    }

    #[test]
    fn liest_stab_schreibweise_und_doppelpunkt() {
        assert_eq!(text("0630"), "06:30");
        assert_eq!(text("06:30"), "06:30");
        assert_eq!(text(" 23:59 "), "23:59");
        assert_eq!(text("00:00"), "00:00");
        assert_eq!(text("2359"), "23:59");
        let u = Uhrzeit::parse("beginn", "0630").unwrap();
        assert_eq!((u.stunde(), u.minute()), (6, 30));
    }

    #[test]
    fn lehnt_alles_andere_mit_400_und_feldnamen_ab() {
        for s in [
            "24:00",
            "6.30",
            "630",
            "12:60",
            "",
            "  ",
            "6:30",
            "06:30:00",
            "6.30 Uhr",
            "ab:cd",
            "０６:３０",
            "-1:30",
            "12-30",
        ] {
            let e = Uhrzeit::parse("ende", s).unwrap_err();
            assert_eq!(e.status(), StatusCode::BAD_REQUEST, "{s:?}");
            assert!(e.to_string().contains("ende"), "{s:?}: {e}");
        }
    }

    #[test]
    fn ordnung_ist_die_des_tages() {
        let u = |s| Uhrzeit::parse("beginn", s).unwrap();
        assert!(u("06:30") < u("12:00"));
        assert!(u("12:00") < u("23:00"));
        assert!(u("09:59") < u("10:00"));
        let mut liste = vec![u("23:00"), u("06:30"), u("12:00")];
        liste.sort();
        assert_eq!(
            liste.iter().map(ToString::to_string).collect::<Vec<_>>(),
            ["06:30", "12:00", "23:00"]
        );
    }
}
