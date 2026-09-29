//! Das eine Zeitformat für Datenbank und Wire: UTC ohne Zonenkennung, sekundengenau.
//! Die String-Sortierung der Zeitspalten hängt daran, dass es überall dasselbe ist.

use chrono::{DateTime, NaiveDateTime, Utc};

pub const FORMAT: &str = "%Y-%m-%d %H:%M:%S";

/// Jetzt (UTC) im kanonischen Format.
pub fn jetzt() -> String {
    Utc::now().format(FORMAT).to_string()
}

pub fn formatiere(t: NaiveDateTime) -> String {
    t.format(FORMAT).to_string()
}

pub fn formatiere_utc(t: DateTime<Utc>) -> String {
    t.format(FORMAT).to_string()
}

/// `None` bei unparsebarem Wert.
pub fn parse(s: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(s, FORMAT).ok()
}

pub fn parse_utc(s: &str) -> Option<DateTime<Utc>> {
    parse(s).map(|n| n.and_utc())
}

/// Zeitstempel + `minuten` im kanonischen Format; `None` bei unparsebarem Wert.
pub fn plus_minuten(s: &str, minuten: i64) -> Option<String> {
    parse(s).map(|t| formatiere(t + chrono::Duration::minutes(minuten)))
}

/// Wie [`parse`], verlangt aber die Rundreise: chrono nimmt ungepolsterte Felder an
/// (`2026-9-3 1:02:03`), die als Text falsch sortierten.
pub fn parse_streng(s: &str) -> Option<NaiveDateTime> {
    parse(s).filter(|t| formatiere(*t) == s)
}

/// Normalisiert eine Formulareingabe (`T` oder Leerzeichen, mit oder ohne Sekunden) aufs
/// kanonische Format; `None`, wenn keins davon passt.
pub fn normalisiere_eingabe(roh: &str) -> Option<String> {
    let roh = roh.trim().replace('T', " ");
    [FORMAT, "%Y-%m-%d %H:%M"]
        .iter()
        .find_map(|fmt| NaiveDateTime::parse_from_str(&roh, fmt).ok())
        .map(formatiere)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eingabe_mit_und_ohne_sekunden() {
        assert_eq!(
            normalisiere_eingabe(" 2026-05-23T10:00 ").as_deref(),
            Some("2026-05-23 10:00:00")
        );
        assert_eq!(
            normalisiere_eingabe("2026-05-23 10:00:07").as_deref(),
            Some("2026-05-23 10:00:07")
        );
        assert_eq!(normalisiere_eingabe("gestern"), None);
    }
}
