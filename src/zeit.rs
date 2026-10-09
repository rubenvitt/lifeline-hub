//! Das eine Zeitformat für Datenbank und Wire: UTC ohne Zonenkennung, sekundengenau.
//! Die String-Sortierung der Zeitspalten hängt daran, dass es überall dasselbe ist.

use chrono::{DateTime, Datelike, NaiveDateTime, TimeDelta, Utc};

use crate::error::AppError;

pub const FORMAT: &str = "%Y-%m-%d %H:%M:%S";

/// Plausibler Jahresbereich eines Zeitpunkts aus einer Eingabe (LFH-924, LFH-1060). Darin hat
/// das Jahr immer vier Stellen, die Textsortierung der Zeitspalten stimmt also; ein
/// Jahres-Tippfehler („0226“) ergäbe sonst eine sofort fällige Frist, die einmal alarmiert.
pub const JAHRE: std::ops::RangeInclusive<i32> = 2000..=2100;

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

/// Zeitstempel + `minuten` im kanonischen Format; `None` bei unparsebarem Wert oder wenn das
/// Ergebnis den darstellbaren Bereich verlässt (LFH-1060: `t + Duration::minutes` panict dort,
/// und die Panic-Schicht macht daraus eine 500).
pub fn plus_minuten(s: &str, minuten: i64) -> Option<String> {
    let t = parse(s)?;
    let dauer = TimeDelta::try_minutes(minuten)?;
    t.checked_add_signed(dauer).map(formatiere)
}

/// Lässt einen kanonischen Zeitstempel nur mit einem Jahr aus [`JAHRE`] durch, sonst
/// `Validation` mit `was` als Feldname (400, `src/AGENTS.md`, Statuscode-Konvention).
pub fn im_jahresbereich(normal: String, was: &str) -> Result<String, AppError> {
    let jahr = parse(&normal)
        .ok_or_else(|| AppError::Validation(format!("{was}: ungültiger Zeitpunkt")))?
        .year();
    if !JAHRE.contains(&jahr) {
        return Err(AppError::Validation(format!(
            "{was} muss zwischen den Jahren {} und {} liegen",
            JAHRE.start(),
            JAHRE.end()
        )));
    }
    Ok(normal)
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

    #[test]
    fn plus_minuten_rechnet_und_meldet_ueberlauf_statt_panic() {
        assert_eq!(
            plus_minuten("2026-05-23 23:30:00", 45).as_deref(),
            Some("2026-05-24 00:15:00")
        );
        assert_eq!(
            plus_minuten("2026-05-23 10:00:00", -30).as_deref(),
            Some("2026-05-23 09:30:00")
        );
        assert_eq!(plus_minuten("kaputt", 1), None);
        // `Duration::minutes` panict ab etwa 1,5e14 Minuten.
        assert_eq!(plus_minuten("2026-05-23 10:00:00", i64::MAX), None);
        assert_eq!(plus_minuten("2026-05-23 10:00:00", i64::MIN), None);
        assert_eq!(
            plus_minuten("2026-05-23 10:00:00", 200_000_000_000_000),
            None
        );
        // Die Addition am Rand des darstellbaren Bereichs.
        let max = formatiere(NaiveDateTime::MAX);
        let min = formatiere(NaiveDateTime::MIN);
        assert!(parse(&max).is_some() && parse(&min).is_some());
        assert_eq!(plus_minuten(&max, 1), None);
        assert_eq!(plus_minuten(&min, -1), None);
    }

    #[test]
    fn jahresbereich_laesst_nur_plausible_jahre_durch() {
        let ok = |s: &str| im_jahresbereich(s.into(), "Frist");
        assert_eq!(ok("2000-01-01 00:00:00").unwrap(), "2000-01-01 00:00:00");
        assert_eq!(ok("2100-12-31 23:59:59").unwrap(), "2100-12-31 23:59:59");
        for s in [
            "1999-12-31 23:59:59",
            "2101-01-01 00:00:00",
            "0226-05-01 10:00:00",
            "-262000-05-01 10:00:00",
            "kaputt",
        ] {
            let err = ok(s).unwrap_err();
            assert_eq!(err.status(), axum::http::StatusCode::BAD_REQUEST, "{s}");
            assert!(err.to_string().starts_with("Frist"), "{s}: {err}");
        }
    }
}
