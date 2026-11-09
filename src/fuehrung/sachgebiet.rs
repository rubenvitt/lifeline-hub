//! Sachgebiete S1–S6 der Führungsorganisation (FwDV 100 Anlage 2). Seit LLH-1602 hier statt im
//! entfernten Stab-Modul: Funktionskatalog, Labels und Auflösung brauchen sie weiter.

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

wire_enum! {
    /// Sachgebiet der Führungsorganisation (FwDV 100 Anlage 2). Wire == `as_str()`.
    ///
    /// Die Reihenfolge ist die der Anlage 2 und zugleich die Anzeigereihenfolge — sie ist
    /// Teil des Vertrags, nicht Dekoration (`ALLE` speist die sechs festen Zeilen).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, ToSchema)]
    pub enum Sachgebiet {
        S1 => "s1",
        S2 => "s2",
        S3 => "s3",
        S4 => "s4",
        S5 => "s5",
        S6 => "s6",
    }
    try_from = |s| format!("Ungültiges Sachgebiet: {s}");
}

impl Sachgebiet {
    /// Standardbezeichnung des Sachgebiets nach FwDV 100 Anlage 2 (S. 54–60). Texte nehmen das
    /// wirksame Mandantenlabel über `fuehrung::Labelkarte` (LFH-549), nicht diese Funktion direkt.
    ///
    /// Liegt im Backend, weil der System-ETB-Eintrag sie trägt („S2 Lage: Besetzung → …") —
    /// ein ETB-Text ist ein Führungsnachweis und darf nicht davon abhängen, welches
    /// Frontend ihn erzeugt hat. Die Anzeige-Labels der sechs Zeilen pflegt das Frontend
    /// daneben in `fuehrung/sachgebiete.ts` (dort zusätzlich mit Aufgaben-Kurztext).
    pub fn label(&self) -> &'static str {
        match self {
            Sachgebiet::S1 => "Personal",
            Sachgebiet::S2 => "Lage",
            Sachgebiet::S3 => "Einsatz",
            Sachgebiet::S4 => "Versorgung",
            Sachgebiet::S5 => "Presse- und Medienarbeit",
            Sachgebiet::S6 => "Information und Kommunikation",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sachgebiet_round_trip_ueber_alle() {
        for sg in Sachgebiet::ALLE {
            assert_eq!(Sachgebiet::parse(sg.as_str()), Some(sg), "{sg:?}");
        }
        assert_eq!(Sachgebiet::parse("s7"), None);
        assert_eq!(Sachgebiet::parse("S1"), None, "Wire ist kleingeschrieben");
        assert_eq!(Sachgebiet::parse(""), None);
    }

    /// Die Anzeigereihenfolge der sechs Zeilen ist Teil des Vertrags (Anlage 2).
    #[test]
    fn sachgebiet_alle_ist_aufsteigend_und_vollstaendig() {
        let wire: Vec<&str> = Sachgebiet::ALLE.iter().map(|s| s.as_str()).collect();
        assert_eq!(wire, ["s1", "s2", "s3", "s4", "s5", "s6"]);
        let mut sortiert = Sachgebiet::ALLE;
        sortiert.sort();
        assert_eq!(sortiert, Sachgebiet::ALLE, "ALLE ist bereits sortiert");
    }
}
