//! Reine, zeit-injizierte Fälligkeitslogik für wiederkehrende Erinnerungen.
//! Bewusst ohne DB/Wall-Clock, damit unit-testbar (vgl. berechtigung.rs).

use chrono::{DateTime, TimeDelta, Utc};

/// Liefert den nächsten Fälligkeitszeitpunkt einer wiederkehrenden Erinnerung,
/// der **echt nach `jetzt`** liegt (skip-forward). Verpasste Slots (Server aus,
/// Lag) werden übersprungen — kein Nachhol-Sturm.
///
/// Rechnet den Slot direkt aus, statt Schritt für Schritt vorzurücken (LFH-924): ein
/// Jahres-Tippfehler („0226“) mit Intervall 1 kostete sonst Milliarden Durchläufe auf dem
/// Planer-Task. Die Arithmetik ist durchgehend geprüft; `None` heißt, es gibt keinen
/// darstellbaren nächsten Slot (Intervall ≤ 0 oder Überlauf). Der Planer markiert die
/// Erinnerung dann nur als ausgelöst, statt an einer chrono-Panic zu sterben.
pub fn naechste_faelligkeit(
    faellig: DateTime<Utc>,
    intervall_min: i64,
    jetzt: DateTime<Utc>,
) -> Option<DateTime<Utc>> {
    if intervall_min <= 0 {
        return None;
    }
    // Mindestens ein Schritt; liegt `faellig` schon zurück, so viele, dass der Slot echt
    // nach `jetzt` liegt. Die Differenz zweier DateTimes passt immer in ein TimeDelta.
    let schritte = if jetzt < faellig {
        1
    } else {
        (jetzt - faellig).num_minutes() / intervall_min + 1
    };
    let minuten = intervall_min.checked_mul(schritte)?;
    faellig.checked_add_signed(TimeDelta::try_minutes(minuten)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(s: &str) -> DateTime<Utc> {
        crate::zeit::parse_utc(s).unwrap()
    }

    #[test]
    fn schiebt_um_genau_ein_intervall_wenn_knapp_ueberfaellig() {
        // fällig 10:00, Intervall 30min, jetzt 10:05 → nächster Slot 10:30.
        assert_eq!(
            naechste_faelligkeit(t("2026-06-11 10:00:00"), 30, t("2026-06-11 10:05:00")),
            Some(t("2026-06-11 10:30:00"))
        );
    }

    #[test]
    fn skip_forward_ueberspringt_verpasste_slots_ohne_sturm() {
        // Server war 2h aus: fällig 10:00, Intervall 30min, jetzt 12:10
        // → nicht 10:30/11:00/…, sondern der erste Slot > jetzt: 12:30.
        assert_eq!(
            naechste_faelligkeit(t("2026-06-11 10:00:00"), 30, t("2026-06-11 12:10:00")),
            Some(t("2026-06-11 12:30:00"))
        );
    }

    #[test]
    fn exakt_auf_slot_schiebt_auf_naechsten() {
        // jetzt == fällig → nächster echter Slot in der Zukunft.
        assert_eq!(
            naechste_faelligkeit(t("2026-06-11 10:00:00"), 30, t("2026-06-11 10:00:00")),
            Some(t("2026-06-11 10:30:00"))
        );
    }

    #[test]
    fn noch_nicht_faellig_rueckt_genau_einen_schritt() {
        assert_eq!(
            naechste_faelligkeit(t("2026-06-11 10:00:00"), 30, t("2026-06-11 09:00:00")),
            Some(t("2026-06-11 10:30:00"))
        );
    }

    #[test]
    fn sekunden_im_slot_zaehlen_mit() {
        // fällig 10:00:30, jetzt 10:30:10: der Slot 10:30:30 liegt noch vorn.
        assert_eq!(
            naechste_faelligkeit(t("2026-06-11 10:00:30"), 30, t("2026-06-11 10:30:10")),
            Some(t("2026-06-11 10:30:30"))
        );
        // 10:30:30 genau getroffen → der übernächste.
        assert_eq!(
            naechste_faelligkeit(t("2026-06-11 10:00:30"), 30, t("2026-06-11 10:30:30")),
            Some(t("2026-06-11 11:00:30"))
        );
    }

    /// LFH-924 (L4): ein riesiges Intervall ergab „DateTime + TimeDelta overflowed“ bzw.
    /// eine Panic in `Duration::minutes` und legte den Planer still.
    #[test]
    fn riesiges_intervall_ergibt_none_statt_panic() {
        let fa = t("2026-06-11 10:00:00");
        let jetzt = t("2026-06-11 10:05:00");
        assert_eq!(naechste_faelligkeit(fa, 999_999_999_999, jetzt), None);
        assert_eq!(naechste_faelligkeit(fa, 200_000_000_000_000, jetzt), None);
        assert_eq!(naechste_faelligkeit(fa, i64::MAX, jetzt), None);
    }

    #[test]
    fn intervall_ohne_wert_ergibt_none() {
        let fa = t("2026-06-11 10:00:00");
        assert_eq!(naechste_faelligkeit(fa, 0, fa), None);
        assert_eq!(naechste_faelligkeit(fa, i64::MIN, fa), None);
    }

    /// LFH-924 (L5): Jahr 0226 mit Intervall 1 rückte vorher ~947 Mio. Slots einzeln vor.
    #[test]
    fn jahres_tippfehler_liefert_den_slot_ohne_schleife() {
        assert_eq!(
            naechste_faelligkeit(t("0226-05-01 10:00:00"), 1, t("2026-06-11 10:05:30")),
            Some(t("2026-06-11 10:06:00"))
        );
        assert_eq!(
            naechste_faelligkeit(t("-262000-05-01 10:00:00"), 1, t("2026-06-11 10:05:30")),
            Some(t("2026-06-11 10:06:00"))
        );
    }

    #[test]
    fn am_rand_des_darstellbaren_ergibt_none() {
        let max = DateTime::<Utc>::MAX_UTC;
        assert_eq!(naechste_faelligkeit(max, 1, max), None);
        let min = DateTime::<Utc>::MIN_UTC;
        assert_eq!(naechste_faelligkeit(min, 1, max), None);
    }
}
