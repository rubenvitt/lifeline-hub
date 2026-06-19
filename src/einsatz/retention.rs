//! Reine, injiziert-`jetzt`-testbare Aufbewahrungs-Logik (LFH-135).
//!
//! Hier liegen die zeitlichen Berechnungen für die Frist-Politik (Dauer → Zeitpunkt)
//! und die Karenz vor der irreversiblen PII-Schwärzung. Bewusst frei von DB-Zugriff
//! und `Utc::now()` — der Aufrufer injiziert `jetzt`, damit die Grenzen deterministisch
//! testbar sind (Muster wie `berechtigung::retention_abgelaufen`).

use chrono::{DateTime, Duration, NaiveDateTime, Utc};

/// Kanonisches DB-Zeitformat (UTC, ohne Zeitzone).
const FMT: &str = "%Y-%m-%d %H:%M:%S";

/// Karenz zwischen Soft-Delete (`geloescht_at`, reversibel) und der irreversiblen
/// PII-Schwärzung — als globale Konstante (wie `NACHLAUF_STUNDEN`), nicht pro Einsatz
/// konfigurierbar. 30 Tage geben genügend Zeit für ein versehentliches Soft-Delete,
/// bevor die Daten endgültig gescrubbt werden.
pub const KARENZ_TAGE: i64 = 30;

/// Parst einen DB-Zeitstempel; bei Unparsbarkeit `None` (defensiv).
fn parse(s: &str) -> Option<DateTime<Utc>> {
    NaiveDateTime::parse_from_str(s, FMT)
        .ok()
        .map(|n| n.and_utc())
}

/// Berechnet den Aufbewahrungs-Zeitpunkt `retention_bis = abschluss + dauer_tage`.
/// `None`, wenn `abschluss` unparsebar ist (defensiv — kein Auto-Fill auf Müll).
/// Das Ergebnis ist im kanonischen DB-Format formatiert.
pub fn berechne_retention_bis(abschluss: &str, dauer_tage: i64) -> Option<String> {
    let start = parse(abschluss)?;
    let bis = start + Duration::days(dauer_tage);
    Some(bis.format(FMT).to_string())
}

/// Ob die Karenz nach einem Soft-Delete abgelaufen ist
/// (`jetzt >= geloescht_at + KARENZ_TAGE`). `None` (nicht soft-gelöscht) oder ein
/// unparsebarer Wert → `false`: erst nach gültigem, abgelaufenem Karenz-Tombstone
/// darf geschwärzt werden.
pub fn karenz_abgelaufen(geloescht_at: Option<&str>, jetzt: DateTime<Utc>) -> bool {
    let Some(s) = geloescht_at else {
        return false;
    };
    let Some(geloescht) = parse(s) else {
        return false;
    };
    jetzt >= geloescht + Duration::days(KARENZ_TAGE)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> DateTime<Utc> {
        NaiveDateTime::parse_from_str(s, FMT).unwrap().and_utc()
    }

    #[test]
    fn berechne_retention_bis_addiert_tage() {
        assert_eq!(
            berechne_retention_bis("2026-06-19 10:00:00", 30).as_deref(),
            Some("2026-07-19 10:00:00")
        );
        // Jahres-Übergang.
        assert_eq!(
            berechne_retention_bis("2026-12-31 23:59:59", 1).as_deref(),
            Some("2027-01-01 23:59:59")
        );
    }

    #[test]
    fn berechne_retention_bis_unparsebar_ist_none() {
        assert_eq!(berechne_retention_bis("kaputt", 30), None);
    }

    #[test]
    fn karenz_abgelaufen_grenzen() {
        let jetzt = t("2026-06-30 12:00:00");
        // Vor KARENZ_TAGE (30) abgelaufen → noch in Karenz (false).
        assert!(!karenz_abgelaufen(Some("2026-06-15 12:00:00"), jetzt));
        // Exakt 30 Tage vorher → abgelaufen (>=).
        assert!(karenz_abgelaufen(Some("2026-05-31 12:00:00"), jetzt));
        // Lange her → abgelaufen.
        assert!(karenz_abgelaufen(Some("2026-01-01 00:00:00"), jetzt));
    }

    #[test]
    fn karenz_abgelaufen_ohne_oder_unparsebar_ist_false() {
        let jetzt = t("2026-06-30 12:00:00");
        assert!(!karenz_abgelaufen(None, jetzt));
        assert!(!karenz_abgelaufen(Some("kaputt"), jetzt));
    }
}
