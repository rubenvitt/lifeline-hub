//! Führungsorganisation eines Einsatzes (LFH-46): Besetzung der Sachgebiete S1–S6. Die
//! Lagebesprechung ist seit LLH-1111 ein eigenes Modul (`crate::lagebesprechung`).
//!
//! **Was S1–S6 hier SIND: Aufgabenzuordnungen mit Besetzungszustand** (FwDV 100 Anlage 2,
//! S. 54–60) — keine Arbeitsplätze, keine Rechteachse, keine Reiter. Die einzige
//! Schreibrechtachse bleibt `EinsatzRolle`/`darfImEinsatzSchreiben`; ein Sachgebiet
//! verleiht kein Recht (Entscheidung 12 der Spec: der Führungsassistent unterstützt,
//! er entscheidet nicht — Anlage 1 Nr. 1.1.4).
//!
//! **Der Personenanker ist `einsatz_personal`, nicht `benutzer`** (Entscheidung 5):
//! `personal.benutzer_id` ist optional, die Mehrheit der Kräfte hat kein Login
//! (`migrations/0010`). Die Benutzer-Kopplung für „meine Sachgebiete" entsteht deshalb
//! transitiv über `personal.benutzer_id`.
//!
//! Spec: `docs/superpowers/specs/2026-09-12-lfh-46-stab-s1-s6-design.md`

use crate::wire_enum::wire_enum;
use serde::Serialize;
use utoipa::ToSchema;

pub mod checkliste;
pub mod fernmeldeskizze;
pub mod kommunikation;
pub mod repo;

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
    /// daneben in `stab/sachgebiete.ts` (dort zusätzlich mit Aufgaben-Kurztext).
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

wire_enum! {
    /// Besetzungszustand eines Sachgebiets (Entscheidung 3 der Spec). Wire == `as_str()`.
    ///
    /// **Keine Zeile = „nicht vergeben"** — das ist der im Fükw der Führungsstufe B
    /// dokumentierte Normalzustand von S1/S4/S5/S6 und deshalb *kein* eigener Enum-Wert.
    /// Der Unterschied zu [`BesetzungArt::Einsatzleitung`] ist die Anregungsfunktion
    /// („haben wir S4 bedacht?").
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum BesetzungArt {
        /// Liegt bewusst bei der Einsatzleitung (Zusammenlegung, Anlage 2 S. 54).
        Einsatzleitung => "einsatzleitung",
        /// Eine disponierte Person (`einsatz_personal`).
        Personal => "personal",
        /// Person ohne Disposition (Freitext-Name).
        Extern => "extern",
        /// Rückwärtige Stelle, z. B. Leitstelle/FEZ (Abschn. 3.2.2.2 S. 16).
        Rueckwaertig => "rueckwaertig",
    }
    try_from = |s| format!("Ungültige Besetzungsart: {s}");
}

/// Maximale Länge von `bezeichnung` (extern/rückwärtig) — wie `fuehrungsstelle`
/// (`src/routes/einsatz.rs`, LFH-461).
pub const BEZEICHNUNG_MAX: usize = 200;

/// Eine belegte Sachgebietszeile.
///
/// `name` trägt je Art `snap_name` (Personal) bzw. `bezeichnung` (extern/rückwärtig) und ist
/// bei [`BesetzungArt::Einsatzleitung`] absent. `personal_noch_disponiert` unterscheidet
/// „Person ist weg" von „Name war nie gesetzt": der Führungsnachweis überlebt das Entfernen
/// der Disposition (`ON DELETE SET NULL` + eingefrorener `snap_name`).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct StabsfunktionAnzeige {
    pub sachgebiet: Sachgebiet,
    pub besetzung_art: BesetzungArt,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub personal_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub personal_noch_disponiert: bool,
    pub gesetzt_von_id: i64,
    pub gesetzt_at: String,
}

/// Die Führungsorganisation eines Einsatzes.
///
/// `besetzung` enthält **nur belegte** Zeilen in `s1..s6`-Reihenfolge; die sechs festen
/// Zeilen baut das Frontend aus [`Sachgebiet::ALLE`] — eine Leerzeile vom Server zu
/// schicken hiesse, „nicht vergeben" als Datensatz zu erfinden. Termin und Lagebesprechungen
/// trägt seit LLH-1111 das Modul Lagebesprechung (`lagebesprechung::LagebesprechungStand`).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct StabAnzeige {
    pub besetzung: Vec<StabsfunktionAnzeige>,
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

    #[test]
    fn besetzung_art_round_trip_ueber_alle() {
        for art in BesetzungArt::ALLE {
            assert_eq!(BesetzungArt::parse(art.as_str()), Some(art), "{art:?}");
        }
        assert_eq!(BesetzungArt::parse("nicht_vergeben"), None);
        assert_eq!(BesetzungArt::parse(""), None);
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
