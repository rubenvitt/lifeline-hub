//! Lebenszustand einer Kraft im Einsatz (LLH-1079, Spec `kraefte-entlassung`).
//!
//! Eine Dispositionszeile wird nicht mehr gelöscht. Sie endet mit `beendet_at`, `beendet_von`
//! und `beendet_als`: **entlassen** ist der Normalweg (die Kraft bleibt im Nachweis),
//! **storniert** korrigiert eine Fehldisposition kurz nach dem Disponieren (die Kraft erscheint
//! in keinem Nachweis, ihre Ereignisse aus der Disposition sind gestrichen). Aktiv heißt
//! `beendet_at IS NULL`; jede Liste, Auswahl und Zahl liest nur aktive Kräfte (Wächter
//! `jede_abfrage_der_kraeftetabellen_prueft_den_zustand`). Eine Einheit wird aufgelöst
//! (`aufgeloest_at`) oder, ohne jede Spur, echt gelöscht.
//!
//! Herleitung: Change `k0s07wsn-kraefte-entlassen`, design.md D2/D3.

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

wire_enum! {
    /// Wie eine Kraft den Einsatz verließ. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum BeendetAls {
        /// Aus dem Einsatz entlassen; bleibt im Nachweis.
        Entlassen => "entlassen",
        /// Fehldisposition storniert; in keinem Nachweis.
        Storniert => "storniert",
    }
    try_from = |s| format!("Ungültiger Endzustand: {s}");
}

/// So lange nach der Disposition lässt sich eine Kraft stornieren (design.md D3, Regel 4).
pub const STORNO_FRIST_MINUTEN: i64 = 15;

/// Streichgrund der Ereignisse einer stornierten Kraft.
pub const GRUND_STORNO: &str = "Fehldisposition storniert";

/// Satz der 422, wenn die Storno-Frist abgelaufen ist.
pub fn storno_frist_text() -> String {
    format!(
        "Stornieren geht nur in den ersten {STORNO_FRIST_MINUTEN} Minuten nach der Disposition; \
         die Kraft lässt sich entlassen"
    )
}

/// Liegt `disponiert_at` höchstens [`STORNO_FRIST_MINUTEN`] vor `jetzt`? Beide im kanonischen
/// Format (`crate::zeit::FORMAT`); ein unlesbarer Zeitpunkt gilt als abgelaufen.
pub fn in_storno_frist(disponiert_at: &str, jetzt: &str) -> bool {
    match crate::zeit::plus_minuten(disponiert_at, STORNO_FRIST_MINUTEN) {
        Some(grenze) => jetzt <= grenze.as_str(),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frist_endet_nach_fuenfzehn_minuten() {
        let d = "2026-10-13 10:00:00";
        assert!(in_storno_frist(d, "2026-10-13 10:05:00"));
        assert!(in_storno_frist(d, "2026-10-13 10:15:00"));
        assert!(!in_storno_frist(d, "2026-10-13 10:15:01"));
        assert!(!in_storno_frist(d, "2026-10-13 10:20:00"));
        assert!(!in_storno_frist("kaputt", "2026-10-13 10:00:00"));
        assert!(storno_frist_text().contains("nur in den ersten 15 Minuten nach der Disposition"));
    }

    #[test]
    fn endzustand_parse_rund() {
        for a in BeendetAls::ALLE {
            assert_eq!(BeendetAls::parse(a.as_str()), Some(a));
        }
        assert_eq!(BeendetAls::parse("geloescht"), None);
    }
}
