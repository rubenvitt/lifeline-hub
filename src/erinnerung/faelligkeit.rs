//! Reine, zeit-injizierte Fälligkeitslogik für wiederkehrende Erinnerungen.
//! Bewusst ohne DB/Wall-Clock, damit unit-testbar (vgl. berechtigung.rs).

use chrono::{DateTime, Duration, Utc};

/// Liefert den nächsten Fälligkeitszeitpunkt einer wiederkehrenden Erinnerung,
/// der **echt nach `jetzt`** liegt (skip-forward). Verpasste Slots (Server aus,
/// Lag) werden übersprungen — kein Nachhol-Sturm. `intervall_min` muss > 0 sein.
pub fn naechste_faelligkeit(
    faellig: DateTime<Utc>,
    intervall_min: i64,
    jetzt: DateTime<Utc>,
) -> DateTime<Utc> {
    let schritt = Duration::minutes(intervall_min.max(1));
    let mut next = faellig;
    // Mindestens einen Schritt; dann so lange, bis der Slot in der Zukunft liegt.
    loop {
        next += schritt;
        if next > jetzt {
            return next;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDateTime;

    fn t(s: &str) -> DateTime<Utc> {
        NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S")
            .unwrap()
            .and_utc()
    }

    #[test]
    fn schiebt_um_genau_ein_intervall_wenn_knapp_ueberfaellig() {
        // fällig 10:00, Intervall 30min, jetzt 10:05 → nächster Slot 10:30.
        assert_eq!(
            naechste_faelligkeit(t("2026-06-11 10:00:00"), 30, t("2026-06-11 10:05:00")),
            t("2026-06-11 10:30:00")
        );
    }

    #[test]
    fn skip_forward_ueberspringt_verpasste_slots_ohne_sturm() {
        // Server war 2h aus: fällig 10:00, Intervall 30min, jetzt 12:10
        // → nicht 10:30/11:00/…, sondern der erste Slot > jetzt: 12:30.
        assert_eq!(
            naechste_faelligkeit(t("2026-06-11 10:00:00"), 30, t("2026-06-11 12:10:00")),
            t("2026-06-11 12:30:00")
        );
    }

    #[test]
    fn exakt_auf_slot_schiebt_auf_naechsten() {
        // jetzt == fällig → nächster echter Slot in der Zukunft.
        assert_eq!(
            naechste_faelligkeit(t("2026-06-11 10:00:00"), 30, t("2026-06-11 10:00:00")),
            t("2026-06-11 10:30:00")
        );
    }
}
