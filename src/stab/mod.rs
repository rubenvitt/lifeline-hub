//! Führungsorganisation eines Einsatzes (LFH-46): Besetzung der Sachgebiete S1–S6 und
//! Lagebesprechungen der Einsatzleitung.
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

use serde::Serialize;
use utoipa::ToSchema;

pub mod repo;

/// Sachgebiet der Führungsorganisation (FwDV 100 Anlage 2). Wire == `as_str()`.
///
/// Die Reihenfolge ist die der Anlage 2 und zugleich die Anzeigereihenfolge — sie ist
/// Teil des Vertrags, nicht Dekoration (`ALLE` speist die sechs festen Zeilen).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Sachgebiet {
    S1,
    S2,
    S3,
    S4,
    S5,
    S6,
}

impl Sachgebiet {
    /// Alle sechs Sachgebiete in Anlage-2-Reihenfolge.
    pub const ALLE: [Sachgebiet; 6] = [
        Sachgebiet::S1,
        Sachgebiet::S2,
        Sachgebiet::S3,
        Sachgebiet::S4,
        Sachgebiet::S5,
        Sachgebiet::S6,
    ];

    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            Sachgebiet::S1 => "s1",
            Sachgebiet::S2 => "s2",
            Sachgebiet::S3 => "s3",
            Sachgebiet::S4 => "s4",
            Sachgebiet::S5 => "s5",
            Sachgebiet::S6 => "s6",
        }
    }

    /// Bezeichnung des Sachgebiets nach FwDV 100 Anlage 2 (S. 54–60).
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

    /// Kurzform für Texte: „S2 Lage".
    pub fn kurz_mit_label(&self) -> String {
        format!("{} {}", self.as_str().to_uppercase(), self.label())
    }

    /// Parst einen gespeicherten/übergebenen Wert; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<Sachgebiet> {
        match s {
            "s1" => Some(Sachgebiet::S1),
            "s2" => Some(Sachgebiet::S2),
            "s3" => Some(Sachgebiet::S3),
            "s4" => Some(Sachgebiet::S4),
            "s5" => Some(Sachgebiet::S5),
            "s6" => Some(Sachgebiet::S6),
            _ => None,
        }
    }
}

impl TryFrom<String> for Sachgebiet {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        Sachgebiet::parse(&s).ok_or_else(|| format!("Ungültiges Sachgebiet: {s}"))
    }
}

/// Besetzungszustand eines Sachgebiets (Entscheidung 3 der Spec). Wire == `as_str()`.
///
/// **Keine Zeile = „nicht vergeben"** — das ist der im Fükw der Führungsstufe B
/// dokumentierte Normalzustand von S1/S4/S5/S6 und deshalb *kein* eigener Enum-Wert.
/// Der Unterschied zu [`BesetzungArt::Einsatzleitung`] ist die Anregungsfunktion
/// („haben wir S4 bedacht?").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum BesetzungArt {
    /// Liegt bewusst bei der Einsatzleitung (Zusammenlegung, Anlage 2 S. 54).
    Einsatzleitung,
    /// Eine disponierte Person (`einsatz_personal`).
    Personal,
    /// Person ohne Disposition (Freitext-Name).
    Extern,
    /// Rückwärtige Stelle, z. B. Leitstelle/FEZ (Abschn. 3.2.2.2 S. 16).
    Rueckwaertig,
}

impl BesetzungArt {
    /// Alle Varianten in kanonischer Reihenfolge.
    pub const ALLE: [BesetzungArt; 4] = [
        BesetzungArt::Einsatzleitung,
        BesetzungArt::Personal,
        BesetzungArt::Extern,
        BesetzungArt::Rueckwaertig,
    ];

    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            BesetzungArt::Einsatzleitung => "einsatzleitung",
            BesetzungArt::Personal => "personal",
            BesetzungArt::Extern => "extern",
            BesetzungArt::Rueckwaertig => "rueckwaertig",
        }
    }

    /// Parst einen gespeicherten/übergebenen Wert; `None` bei ungültigem Wert.
    pub fn parse(s: &str) -> Option<BesetzungArt> {
        match s {
            "einsatzleitung" => Some(BesetzungArt::Einsatzleitung),
            "personal" => Some(BesetzungArt::Personal),
            "extern" => Some(BesetzungArt::Extern),
            "rueckwaertig" => Some(BesetzungArt::Rueckwaertig),
            _ => None,
        }
    }
}

impl TryFrom<String> for BesetzungArt {
    type Error = String;

    fn try_from(s: String) -> Result<Self, Self::Error> {
        BesetzungArt::parse(&s).ok_or_else(|| format!("Ungültige Besetzungsart: {s}"))
    }
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
/// schicken hiesse, „nicht vergeben" als Datensatz zu erfinden.
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
