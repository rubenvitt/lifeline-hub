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

    /// Property-Tests (LLH-2090): das Format trägt die Textsortierung der Zeitspalten, also muss
    /// es für jeden Zeitpunkt mit vierstelligem Jahr verlustfrei und ordnungstreu sein.
    mod eigenschaften {
        use super::*;
        use chrono::NaiveDate;
        use proptest::prelude::*;

        /// Sekundengenaue Zeitpunkte mit vierstelligem Jahr.
        fn zeitpunkt() -> impl Strategy<Value = NaiveDateTime> {
            (
                0i32..=9999,
                1u32..=12,
                1u32..=31,
                0u32..24,
                0u32..60,
                0u32..60,
            )
                .prop_filter_map("kein gültiges Datum", |(j, mo, t, h, mi, s)| {
                    NaiveDate::from_ymd_opt(j, mo, t)?.and_hms_opt(h, mi, s)
                })
        }

        proptest! {
            #[test]
            fn formatieren_und_streng_lesen_ergibt_denselben_zeitpunkt(t in zeitpunkt()) {
                prop_assert_eq!(parse_streng(&formatiere(t)), Some(t));
            }

            #[test]
            fn textsortierung_entspricht_der_zeitfolge(a in zeitpunkt(), b in zeitpunkt()) {
                prop_assert_eq!(formatiere(a).cmp(&formatiere(b)), a.cmp(&b));
            }

            #[test]
            fn normalisierte_eingabe_ist_kanonisch_und_bleibt_beim_zweiten_mal_gleich(
                t in zeitpunkt(),
                trenner in prop::sample::select(vec!["T", " "]),
                mit_sekunden in any::<bool>(),
                rand in "[ \t]{0,2}",
            ) {
                let fmt = if mit_sekunden { "%Y-%m-%d{T}%H:%M:%S" } else { "%Y-%m-%d{T}%H:%M" };
                let roh = format!("{rand}{}{rand}", t.format(&fmt.replace("{T}", trenner)));
                let normal = normalisiere_eingabe(&roh).expect("gültige Eingabe");
                prop_assert!(parse_streng(&normal).is_some(), "{normal} ist nicht kanonisch");
                prop_assert_eq!(normalisiere_eingabe(&normal), Some(normal));
            }

            #[test]
            fn normalisieren_beliebiger_eingaben_panict_nie_und_bleibt_idempotent(roh in any::<String>()) {
                if let Some(normal) = normalisiere_eingabe(&roh) {
                    prop_assert_eq!(normalisiere_eingabe(&normal), Some(normal));
                }
            }

            #[test]
            fn minuten_addieren_panict_nie_und_laesst_sich_zuruecknehmen(
                t in zeitpunkt(),
                minuten in prop_oneof![any::<i64>(), -10_000_000i64..10_000_000],
            ) {
                let s = formatiere(t);
                if let Some(spaeter) = plus_minuten(&s, minuten) {
                    prop_assert_eq!(plus_minuten(&spaeter, -minuten), Some(s));
                }
            }
        }
    }
}
