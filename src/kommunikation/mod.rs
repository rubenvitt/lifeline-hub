//! Gemeinsamer Kommunikations-Unterbau (LFH-84): geteilte Zustellungs- und
//! Status-Mechanik (Quittung vs. Vollzug — sauber getrennt) für die
//! Kommunikations-Module (Chat, Erinnerung, künftig Aufträge/Meldungen).
pub mod repo;

use serde::Serialize;

/// Vokabular-Re-Export: Single Source of Truth bleibt das ETB-Modul. Module
/// referenzieren `kommunikation::{EtbTyp, MeldeWeg}` statt eigene Vokabulare zu
/// definieren. (Funkrufname lebt fachlich an `einheit`/`fahrzeug` und wird dort
/// referenziert — kein Enum zum Re-Export.)
pub use crate::etb::{EtbTyp, MeldeWeg};

/// Objekttyp für die polymorphe Referenz `(objekt_typ, objekt_id)`.
pub const OBJEKT_CHAT_NACHRICHT: &str = "chat_nachricht";
pub const OBJEKT_ERINNERUNG: &str = "erinnerung";
pub const OBJEKT_AUFTRAG: &str = "auftrag";

/// Vollzug-Achse (Achse 2): Bearbeitungszustand eines Objekts.
pub const VOLLZUG_OFFEN: &str = "offen";
pub const VOLLZUG_IN_ARBEIT: &str = "in_arbeit";
pub const VOLLZUG_VOLLZOGEN: &str = "vollzogen";

/// Geteilter Status eines Objekts: beide Achsen getrennt. `quittiert_at` ist die
/// Quittungs-Achse, `vollzug_status`/`vollzogen_at` die Vollzugs-Achse — beide
/// unabhängig setzbar.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct KommunikationStatus {
    pub objekt_typ: String,
    pub objekt_id: i64,
    pub quittiert_at: Option<String>,
    pub quittiert_von_id: Option<i64>,
    pub vollzug_status: String,
    pub vollzogen_at: Option<String>,
    pub vollzogen_von_id: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vollzug_konstanten_sind_eindeutig() {
        assert_ne!(VOLLZUG_OFFEN, VOLLZUG_VOLLZOGEN);
        assert_ne!(VOLLZUG_OFFEN, VOLLZUG_IN_ARBEIT);
    }

    #[test]
    fn vokabular_wird_aus_etb_referenziert() {
        assert_eq!(EtbTyp::Meldung.as_str(), crate::etb::EtbTyp::Meldung.as_str());
        assert_eq!(MeldeWeg::Funk.as_str(), "funk");
    }

    #[test]
    fn objekt_typen_sind_eindeutig() {
        assert_ne!(OBJEKT_CHAT_NACHRICHT, OBJEKT_ERINNERUNG);
        assert_ne!(OBJEKT_AUFTRAG, OBJEKT_ERINNERUNG);
        assert_ne!(OBJEKT_AUFTRAG, OBJEKT_CHAT_NACHRICHT);
    }
}
