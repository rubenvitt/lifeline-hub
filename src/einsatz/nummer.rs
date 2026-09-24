//! Systemgenerierte Einsatznummer `<Präfix><JJJJ>-<NNNN>` (LFH-617).
//!
//! Zwei reine Bausteine der Vergabe in `repo::anlegen`: das Format und das Jahr in der
//! Zeitzone der Organisation. Beide nehmen ihre Eingaben von aussen (auch `jetzt`), damit
//! die Neujahrsgrenze ohne Uhr-Mock prüfbar ist.

use chrono::{DateTime, Datelike, Utc};
use chrono_tz::Tz;

/// Präfix, wenn die Organisation keines eingestellt hat.
pub const PRAEFIX_VORGABE: &str = "E-";

/// Zeitzone, wenn die Organisation keine (gültige) eingestellt hat — dieselbe Vorgabe,
/// die die Anzeige-Einstellungen als Fallback nennen.
pub const ZEITZONE_VORGABE: Tz = chrono_tz::Europe::Berlin;

/// `<Präfix><JJJJ>-<NNNN>`: die laufende Nummer mindestens 4-stellig, darüber ungekürzt.
/// Das Präfix wird wörtlich übernommen; `None` → [`PRAEFIX_VORGABE`].
pub fn formatiere(praefix: Option<&str>, jahr: i32, lfd: i64) -> String {
    let praefix = praefix.unwrap_or(PRAEFIX_VORGABE);
    format!("{praefix}{jahr}-{lfd:04}")
}

/// Kalenderjahr von `jetzt` in der Zeitzone `zeitzone` (IANA-Name). Fehlt sie oder ist
/// sie unbekannt, gilt [`ZEITZONE_VORGABE`] — Letzteres mit Warnung, denn die Validierung
/// der Einstellung prüft nur „nicht leer“ und ein Tippfehler fiele sonst still auf Berlin.
pub fn jahr_in_zone(jetzt: DateTime<Utc>, zeitzone: Option<&str>) -> i32 {
    jetzt.with_timezone(&zone_oder_vorgabe(zeitzone)).year()
}

/// Die Org-Zeitzone als [`Tz`] (IANA-Name). Fehlt sie oder ist sie unbekannt, gilt
/// [`ZEITZONE_VORGABE`] — Letzteres mit Warnung, weil ein Tippfehler in der Einstellung
/// sonst still auf Berlin fiele. Geteilt von der Einsatznummer und den ETB-Texten der
/// Verpflegung (LFH-634), damit beide dieselbe Rückfallregel haben.
pub fn zone_oder_vorgabe(zeitzone: Option<&str>) -> Tz {
    match zeitzone {
        None => ZEITZONE_VORGABE,
        Some(name) => name.trim().parse::<Tz>().unwrap_or_else(|_| {
            tracing::warn!(
                zeitzone = name,
                "Unbekannte Org-Zeitzone; es gilt Europe/Berlin"
            );
            ZEITZONE_VORGABE
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn utc(s: &str) -> DateTime<Utc> {
        Utc.from_utc_datetime(
            &chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap(),
        )
    }

    #[test]
    fn format_vorgabe_praefix_und_padding() {
        assert_eq!(formatiere(None, 2026, 1), "E-2026-0001");
        assert_eq!(formatiere(None, 2026, 431), "E-2026-0431");
    }

    #[test]
    fn format_ueber_9999_ungekuerzt() {
        assert_eq!(formatiere(None, 2026, 9999), "E-2026-9999");
        assert_eq!(formatiere(None, 2026, 10000), "E-2026-10000");
    }

    #[test]
    fn format_eigenes_praefix_woertlich() {
        assert_eq!(formatiere(Some("WF-"), 2027, 4), "WF-2027-0004");
        assert_eq!(formatiere(Some("E"), 2027, 4), "E2027-0004");
    }

    #[test]
    fn neujahr_in_berlin_eine_stunde_vor_utc() {
        // Winterzeit: MEZ = UTC+1. 23:00 UTC ist schon 00:00 am 1. Januar.
        assert_eq!(
            jahr_in_zone(utc("2026-12-31 22:59:59"), Some("Europe/Berlin")),
            2026
        );
        assert_eq!(
            jahr_in_zone(utc("2026-12-31 23:00:00"), Some("Europe/Berlin")),
            2027
        );
        assert_eq!(
            jahr_in_zone(utc("2026-12-31 23:30:00"), Some("Europe/Berlin")),
            2027
        );
    }

    #[test]
    fn utc_zeitzone_zaehlt_nach_utc() {
        assert_eq!(jahr_in_zone(utc("2026-12-31 23:30:00"), Some("UTC")), 2026);
        assert_eq!(jahr_in_zone(utc("2027-01-01 00:00:00"), Some("UTC")), 2027);
    }

    #[test]
    fn ohne_zeitzone_gilt_berlin() {
        assert_eq!(jahr_in_zone(utc("2026-12-31 22:59:59"), None), 2026);
        assert_eq!(jahr_in_zone(utc("2026-12-31 23:00:00"), None), 2027);
    }

    #[test]
    fn unbekannte_zeitzone_gilt_berlin() {
        assert_eq!(
            jahr_in_zone(utc("2026-12-31 23:00:00"), Some("Quatsch/Zone")),
            2027
        );
        assert_eq!(
            jahr_in_zone(utc("2026-12-31 22:59:59"), Some("Quatsch/Zone")),
            2026
        );
    }

    #[test]
    fn sommerzeit_zone_suedhalbkugel() {
        // Sydney im Dezember: AEDT = UTC+11. 13:00 UTC ist schon Neujahr.
        assert_eq!(
            jahr_in_zone(utc("2026-12-31 12:59:59"), Some("Australia/Sydney")),
            2026
        );
        assert_eq!(
            jahr_in_zone(utc("2026-12-31 13:00:00"), Some("Australia/Sydney")),
            2027
        );
    }

    #[test]
    fn westliche_zone_haengt_nach() {
        // New York: EST = UTC-5. 03:00 UTC am 1.1. ist noch Silvester.
        assert_eq!(
            jahr_in_zone(utc("2027-01-01 04:59:59"), Some("America/New_York")),
            2026
        );
        assert_eq!(
            jahr_in_zone(utc("2027-01-01 05:00:00"), Some("America/New_York")),
            2027
        );
    }
}
