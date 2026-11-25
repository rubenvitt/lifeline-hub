//! ICS-Datei für den Lagebesprechungstermin (LLH-1111 Folge, Zunder `p133o8h2`).
//!
//! Reine Funktion ohne Zugriff auf Datenbank oder Uhr: der Aufrufer liefert Einsatz, Termin,
//! Instanzkennung und „jetzt“. Alle Zeiten sind UTC (ADR-0012), es braucht kein `VTIMEZONE`.
//! Die Datei ist eine Veröffentlichung (`METHOD:PUBLISH`), kein `ORGANIZER`, kein `ATTENDEE`.

use chrono::{DateTime, Duration, Utc};

/// Höchstlänge der Bezeichnung in Zeichen, vor dem Escaping.
const BEZEICHNUNG_MAX: usize = 200;
/// Höchstlänge einer Zeile in Oktetten, ohne CRLF (RFC 5545, 3.1).
const ZEILE_MAX: usize = 75;
/// Zeitformat der ICS-Datei (UTC).
const ICS_ZEIT: &str = "%Y%m%dT%H%M%SZ";

/// Eingabe des Generators.
pub struct IcsEingabe<'a> {
    pub einsatz_id: i64,
    pub bezeichnung: &'a str,
    pub termin: DateTime<Utc>,
    pub instanz_kennung: &'a str,
}

/// Dateiname des Downloads: `lagebesprechung-einsatz-<id>-<YYYY-MM-DD-HHMM>.ics`.
pub fn build_dateiname(einsatz_id: i64, termin: DateTime<Utc>) -> String {
    format!(
        "lagebesprechung-einsatz-{einsatz_id}-{}.ics",
        termin.format("%Y-%m-%d-%H%M")
    )
}

/// Baut die ICS-Datei: CRLF-Zeilen, gefaltet bei 75 Oktetten.
pub fn build_ics(eingabe: &IcsEingabe<'_>, jetzt: DateTime<Utc>) -> String {
    let beginn = eingabe.termin.format(ICS_ZEIT).to_string();
    let ende = (eingabe.termin + Duration::minutes(30))
        .format(ICS_ZEIT)
        .to_string();
    let bezeichnung: String = eingabe.bezeichnung.chars().take(BEZEICHNUNG_MAX).collect();
    let zeilen = [
        "BEGIN:VCALENDAR".to_string(),
        "VERSION:2.0".to_string(),
        "PRODID:-//Lifeline Hub//Lagebesprechung//DE".to_string(),
        "CALSCALE:GREGORIAN".to_string(),
        "METHOD:PUBLISH".to_string(),
        "BEGIN:VEVENT".to_string(),
        format!(
            "UID:lagebesprechung-{}-{beginn}@{}",
            eingabe.einsatz_id,
            escape_text(eingabe.instanz_kennung)
        ),
        format!("DTSTAMP:{}", jetzt.format(ICS_ZEIT)),
        "SEQUENCE:0".to_string(),
        format!("DTSTART:{beginn}"),
        format!("DTEND:{ende}"),
        format!("SUMMARY:Lagebesprechung – {}", escape_text(&bezeichnung)),
        "STATUS:CONFIRMED".to_string(),
        "TRANSP:OPAQUE".to_string(),
        "BEGIN:VALARM".to_string(),
        "ACTION:DISPLAY".to_string(),
        "DESCRIPTION:Lagebesprechung".to_string(),
        "TRIGGER:-PT10M".to_string(),
        "END:VALARM".to_string(),
        "END:VEVENT".to_string(),
        "END:VCALENDAR".to_string(),
    ];
    let mut aus = String::new();
    for zeile in &zeilen {
        fold_zeile(zeile, &mut aus);
    }
    aus
}

/// TEXT-Escaping nach RFC 5545, 3.3.11. Zeilenumbrüche werden vorher vereinheitlicht, andere
/// Steuerzeichen außer HTAB entfernt.
fn escape_text(text: &str) -> String {
    let einheitlich = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut aus = String::with_capacity(einheitlich.len());
    for zeichen in einheitlich.chars() {
        match zeichen {
            '\\' => aus.push_str("\\\\"),
            ';' => aus.push_str("\\;"),
            ',' => aus.push_str("\\,"),
            '\n' => aus.push_str("\\n"),
            '\t' => aus.push('\t'),
            z if z.is_control() => {}
            z => aus.push(z),
        }
    }
    aus
}

/// Hängt die Zeile gefaltet an `aus` an. Fortsetzungszeilen beginnen mit einem Leerzeichen, das
/// zu ihren 75 Oktetten zählt; ein UTF-8-Zeichen wird nie geteilt.
fn fold_zeile(zeile: &str, aus: &mut String) {
    let mut grenze = ZEILE_MAX;
    let mut belegt = 0;
    for zeichen in zeile.chars() {
        let laenge = zeichen.len_utf8();
        if belegt + laenge > grenze {
            aus.push_str("\r\n ");
            belegt = 1;
            grenze = ZEILE_MAX;
        }
        aus.push(zeichen);
        belegt += laenge;
    }
    aus.push_str("\r\n");
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn termin() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 24, 14, 30, 0).unwrap()
    }

    fn jetzt() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 24, 12, 0, 0).unwrap()
    }

    fn ics(bezeichnung: &str) -> String {
        build_ics(
            &IcsEingabe {
                einsatz_id: 42,
                bezeichnung,
                termin: termin(),
                instanz_kennung: "kennung-1",
            },
            jetzt(),
        )
    }

    fn entfaltet(ics: &str) -> String {
        ics.replace("\r\n ", "")
    }

    #[test]
    fn jede_zeile_endet_mit_crlf_und_ist_hoechstens_75_oktette() {
        let lang = "Überschwemmung Ölbachtal Größenwahn ÄÖÜ ".repeat(8);
        let datei = ics(&lang);
        assert!(datei.ends_with("\r\n"));
        let ohne_ende = &datei[..datei.len() - 2];
        let mut fortsetzungen = 0;
        for (i, zeile) in ohne_ende.split("\r\n").enumerate() {
            assert!(zeile.len() <= 75, "Zeile {i} hat {} Oktette", zeile.len());
            assert!(String::from_utf8(zeile.as_bytes().to_vec()).is_ok());
            if zeile.starts_with(' ') {
                fortsetzungen += 1;
            }
        }
        assert!(fortsetzungen > 0, "es muss gefaltet worden sein");
        assert!(!datei.replace("\r\n", "").contains('\n'));
        let gekuerzt: String = lang.chars().take(200).collect();
        assert!(entfaltet(&datei).contains(&format!("SUMMARY:Lagebesprechung – {gekuerzt}\r\n")));
    }

    #[test]
    fn escaping_nach_rfc5545() {
        let datei = entfaltet(&ics("A, B; C\\D\r\nE\u{7}"));
        assert!(
            datei.contains("SUMMARY:Lagebesprechung – A\\, B\\; C\\\\D\\nE\r\n"),
            "{datei}"
        );
        assert!(!datei.contains('\u{7}'));
    }

    #[test]
    fn dauer_dreissig_minuten_und_alarm() {
        let datei = ics("Hochwasser");
        assert!(datei.contains("DTSTART:20261124T143000Z\r\n"));
        assert!(datei.contains("DTEND:20261124T150000Z\r\n"));
        assert!(datei.contains("DTSTAMP:20261124T120000Z\r\n"));
        assert!(datei.contains("TRIGGER:-PT10M\r\n"));
        assert!(datei.contains("SEQUENCE:0\r\n"));
        assert!(datei.contains("METHOD:PUBLISH\r\n"));
        assert!(!datei.contains("ORGANIZER"));
        assert!(!datei.contains("ATTENDEE"));
    }

    #[test]
    fn uid_je_termin() {
        let datei = ics("X");
        assert!(datei.contains("UID:lagebesprechung-42-20261124T143000Z@kennung-1\r\n"));
        let anderer = build_ics(
            &IcsEingabe {
                einsatz_id: 42,
                bezeichnung: "X",
                termin: termin() + Duration::hours(1),
                instanz_kennung: "kennung-1",
            },
            jetzt(),
        );
        assert!(anderer.contains("UID:lagebesprechung-42-20261124T153000Z@kennung-1\r\n"));
        assert!(!anderer.contains("20261124T143000Z@"));
    }

    #[test]
    fn bezeichnung_wird_auf_200_zeichen_gekuerzt() {
        let datei = entfaltet(&ics(&"ä".repeat(300)));
        let erwartet = format!("SUMMARY:Lagebesprechung – {}\r\n", "ä".repeat(200));
        assert!(datei.contains(&erwartet));
    }

    #[test]
    fn dateiname_traegt_einsatz_und_termin() {
        assert_eq!(
            build_dateiname(42, termin()),
            "lagebesprechung-einsatz-42-2026-11-24-1430.ics"
        );
    }
}
