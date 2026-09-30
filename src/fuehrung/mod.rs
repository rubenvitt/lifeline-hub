//! Katalog der Führungsfunktionen (LFH-549, FwDV 100 Anlage 1/2).
//!
//! Ein **geschlossener** Katalog: Leitung (`el`), die Sachgebiete `s1`–`s6` (Anlage 2, getragen
//! vom Führungsassistenten, Anlage 1 Nr. 1.1.4), `s7` PSNV (keine FwDV-100-Kategorie, nur per
//! Org-Schalter), Führungshilfspersonal und Fachberater (Anlage 1 Nr. 1.1.5, Anlage 3). Die
//! letzten beiden sind **kein** Sachgebiet und werden nie in eine S-Zeile gefaltet; sie tragen
//! eine Pflicht-Bezeichnung („Lagekartenführer“, „THW“).
//!
//! Eine Organisation überschreibt nur Anzeigelabels (THW: „Versorgung (Logistik)“) und schaltet
//! S7 ein ([`repo`]); den Katalog selbst pflegt niemand.
//!
//! Verwendet an drei Freitextfeldern — Erinnerung, Auftragsempfänger, Führungsstelle — als
//! Codespalte neben dem Bestandstext. **Kein Rückschluss vom Freitext auf einen Code**, auch
//! nicht bei exakter Gleichheit: ein „S 3“ fiele still heraus.
//!
//! Herleitung: `openspec/changes/archive/2026-09-30-lfh-549-funktionskatalog/design.md`.

use crate::error::AppError;
use crate::stab::Sachgebiet;
use crate::wire_enum::wire_enum;
use serde::Serialize;
use std::collections::HashMap;
use utoipa::ToSchema;

pub mod aufloesung;
pub mod repo;

wire_enum! {
    /// Führungsfunktion aus dem Katalog. Wire == `as_str()`.
    ///
    /// Die Reihenfolge ist die Anzeigereihenfolge des Katalogs (Teil des Vertrags). Die
    /// CHECK-Listen in `migrations/0127_fuehrungsfunktion.sql` spiegeln `ALLE`
    /// (Guard `check_listen_entsprechen_dem_katalog`).
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, ToSchema)]
    pub enum Fuehrungsfunktion {
        El => "el",
        S1 => "s1",
        S2 => "s2",
        S3 => "s3",
        S4 => "s4",
        S5 => "s5",
        S6 => "s6",
        S7 => "s7",
        Fuehrungshilfspersonal => "fuehrungshilfspersonal",
        Fachberater => "fachberater",
    }
    try_from = |s| format!("Ungültige Führungsfunktion: {s}");
}

wire_enum! {
    /// Art der Führungsfunktion nach FwDV 100 Anlage 1 (Nr. 1.1.4/1.1.5). Aus dem Code
    /// abgeleitet, nie gespeichert und nie vom Client gesetzt.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
    pub enum FunktionsArt {
        Leitung => "leitung",
        /// Sachgebiet, vom Führungsassistenten getragen.
        Sachgebiet => "sachgebiet",
        Fuehrungshilfspersonal => "fuehrungshilfspersonal",
        Fachberater => "fachberater",
    }
}

impl Fuehrungsfunktion {
    pub fn art(&self) -> FunktionsArt {
        match self {
            Fuehrungsfunktion::El => FunktionsArt::Leitung,
            Fuehrungsfunktion::Fuehrungshilfspersonal => FunktionsArt::Fuehrungshilfspersonal,
            Fuehrungsfunktion::Fachberater => FunktionsArt::Fachberater,
            _ => FunktionsArt::Sachgebiet,
        }
    }

    /// Das Sachgebiet der Stab-Besetzung (LFH-46), auf das die Funktion zur Lesezeit auflöst.
    /// S7 hat keine Besetzung, die übrigen Arten ohnehin nicht.
    pub fn sachgebiet(&self) -> Option<Sachgebiet> {
        match self {
            Fuehrungsfunktion::S1 => Some(Sachgebiet::S1),
            Fuehrungsfunktion::S2 => Some(Sachgebiet::S2),
            Fuehrungsfunktion::S3 => Some(Sachgebiet::S3),
            Fuehrungsfunktion::S4 => Some(Sachgebiet::S4),
            Fuehrungsfunktion::S5 => Some(Sachgebiet::S5),
            Fuehrungsfunktion::S6 => Some(Sachgebiet::S6),
            _ => None,
        }
    }

    /// Umkehrung von [`Self::sachgebiet`].
    pub fn aus_sachgebiet(sg: Sachgebiet) -> Fuehrungsfunktion {
        match sg {
            Sachgebiet::S1 => Fuehrungsfunktion::S1,
            Sachgebiet::S2 => Fuehrungsfunktion::S2,
            Sachgebiet::S3 => Fuehrungsfunktion::S3,
            Sachgebiet::S4 => Fuehrungsfunktion::S4,
            Sachgebiet::S5 => Fuehrungsfunktion::S5,
            Sachgebiet::S6 => Fuehrungsfunktion::S6,
        }
    }

    /// Kürzel („EL“, „S3“); Führungshilfspersonal und Fachberater haben keins — sie erscheinen
    /// als „<Label>: <Bezeichnung>“.
    pub fn kuerzel(&self) -> Option<&'static str> {
        match self {
            Fuehrungsfunktion::El => Some("EL"),
            Fuehrungsfunktion::S1 => Some("S1"),
            Fuehrungsfunktion::S2 => Some("S2"),
            Fuehrungsfunktion::S3 => Some("S3"),
            Fuehrungsfunktion::S4 => Some("S4"),
            Fuehrungsfunktion::S5 => Some("S5"),
            Fuehrungsfunktion::S6 => Some("S6"),
            Fuehrungsfunktion::S7 => Some("S7"),
            Fuehrungsfunktion::Fuehrungshilfspersonal | Fuehrungsfunktion::Fachberater => None,
        }
    }

    /// Standardlabel; s1–s6 kommen aus [`Sachgebiet::label`] (eine Quelle, keine zweite Liste).
    pub fn standard_label(&self) -> &'static str {
        if let Some(sg) = self.sachgebiet() {
            return sg.label();
        }
        match self {
            Fuehrungsfunktion::El => "Einsatzleitung",
            Fuehrungsfunktion::S7 => "Psychosoziale Notfallversorgung",
            Fuehrungsfunktion::Fuehrungshilfspersonal => "Führungshilfspersonal",
            Fuehrungsfunktion::Fachberater => "Fachberater",
            _ => unreachable!("Sachgebiete oben behandelt"),
        }
    }

    /// Ob die Funktion eine Bezeichnung braucht (Führungshilfspersonal, Fachberater).
    pub fn bezeichnung_pflicht(&self) -> bool {
        self.kuerzel().is_none()
    }
}

/// Maximale Länge eines Mandantenlabels.
pub const LABEL_MAX: usize = 60;
/// Maximale Länge von Bezeichnung bzw. Freitext — wie `fuehrungsstelle` (LFH-461).
pub const TEXT_MAX: usize = 200;

/// Wirksame Labels einer Organisation plus S7-Schalter. Einmal je Anfrage geladen
/// ([`repo::labelkarte`]) und an alle Stellen gereicht, die Text erzeugen.
#[derive(Debug, Clone, Default)]
pub struct Labelkarte {
    pub(crate) ueberschrieben: HashMap<Fuehrungsfunktion, String>,
    pub s7_aktiv: bool,
}

impl Labelkarte {
    /// Nur Standardlabels, S7 aus — für Kontexte ohne Organisation (Tests, Snapshots).
    pub fn standard() -> Self {
        Self::default()
    }

    pub fn label(&self, f: Fuehrungsfunktion) -> &str {
        self.ueberschrieben
            .get(&f)
            .map(String::as_str)
            .unwrap_or_else(|| f.standard_label())
    }

    /// „S3 Einsatz“ — Kürzel mit wirksamem Label (für Stab-Zeilen, Kopf, System-ETB). Die
    /// Leitung erscheint nur mit Label („Einsatzleitung“, nicht „EL Einsatzleitung“).
    pub fn kurz_mit_label(&self, f: Fuehrungsfunktion) -> String {
        match (f, f.kuerzel()) {
            (Fuehrungsfunktion::El, _) | (_, None) => self.label(f).to_string(),
            (_, Some(k)) => format!("{k} {}", self.label(f)),
        }
    }

    /// Anzeige eines Empfängers mit Code — der Snapshot: „S3 Einsatz“, „Einsatzleitung“,
    /// „Fachberater: THW“. **Nie ein Personenname** (design.md D4).
    pub fn anzeige(&self, f: Fuehrungsfunktion, bezeichnung: Option<&str>) -> String {
        match (f.bezeichnung_pflicht(), bezeichnung) {
            (true, Some(b)) => format!("{}: {b}", self.label(f)),
            _ => self.kurz_mit_label(f),
        }
    }

    /// Kurzform für die ETB-Vorbelegung: Kürzel, bei Führungshilfspersonal/Fachberater
    /// „<Label>: <Bezeichnung>“.
    pub fn vorbelegung(&self, f: Fuehrungsfunktion, bezeichnung: Option<&str>) -> String {
        match f.kuerzel() {
            Some(k) => k.to_string(),
            None => self.anzeige(f, bezeichnung),
        }
    }

    /// Der wirksame Katalog in Anzeigereihenfolge; S7 nur, wenn eingeschaltet.
    pub fn katalog(&self) -> Vec<FuehrungsfunktionAnzeige> {
        Fuehrungsfunktion::ALLE
            .iter()
            .filter(|f| **f != Fuehrungsfunktion::S7 || self.s7_aktiv)
            .map(|f| FuehrungsfunktionAnzeige {
                funktion: *f,
                kuerzel: f.kuerzel().map(str::to_string),
                label: self.label(*f).to_string(),
                standard_label: f.standard_label().to_string(),
                art: f.art(),
                bezeichnung_pflicht: f.bezeichnung_pflicht(),
            })
            .collect()
    }
}

/// Ein Katalogeintrag, wie ihn `GET /api/fuehrungsfunktionen` liefert.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct FuehrungsfunktionAnzeige {
    pub funktion: Fuehrungsfunktion,
    /// „EL“, „S3“; fehlt bei Führungshilfspersonal und Fachberater.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kuerzel: Option<String>,
    /// Wirksames Label (Mandantenlabel oder Standard).
    pub label: String,
    pub standard_label: String,
    pub art: FunktionsArt,
    pub bezeichnung_pflicht: bool,
}

/// Geprüfte Funktionsangabe: Code (optional) und Text in seiner Doppelrolle — Freitext ohne
/// Code, Bezeichnung bei Führungshilfspersonal/Fachberater, sonst `None`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Funktionsangabe {
    pub funktion: Option<Fuehrungsfunktion>,
    pub text: Option<String>,
}

impl Funktionsangabe {
    pub fn ist_leer(&self) -> bool {
        self.funktion.is_none() && self.text.is_none()
    }
}

/// Prüft Code und Text einer Funktionsangabe (Statuscodes nach LFH-267, design.md D3):
///
/// * unbekannter Code → 400;
/// * Text zu lang → 400;
/// * Bezeichnung fehlt bei Führungshilfspersonal/Fachberater → 422 (Feldkombination);
/// * Text zu `el`/Sachgebiet → 422;
/// * `s7` bei ausgeschaltetem S7 → 422.
///
/// Der Text wird getrimmt, leer = `None`. Ob die Angabe überhaupt Pflicht ist, entscheidet der
/// Aufrufer (`Funktionsangabe::ist_leer`).
pub fn pruefe_funktion(
    code: Option<&str>,
    text: Option<&str>,
    s7_aktiv: bool,
) -> Result<Funktionsangabe, AppError> {
    let text = text.map(str::trim).filter(|t| !t.is_empty());
    if let Some(t) = text {
        if t.chars().count() > TEXT_MAX {
            return Err(AppError::Validation(format!(
                "Funktion/Bezeichnung darf höchstens {TEXT_MAX} Zeichen lang sein"
            )));
        }
    }
    let code = code.map(str::trim).filter(|c| !c.is_empty());
    let Some(code) = code else {
        return Ok(Funktionsangabe {
            funktion: None,
            text: text.map(str::to_string),
        });
    };
    let f = Fuehrungsfunktion::parse(code)
        .ok_or_else(|| AppError::Validation(format!("Unbekannte Führungsfunktion: {code}")))?;
    if f == Fuehrungsfunktion::S7 && !s7_aktiv {
        return Err(AppError::UnprocessableEntity(
            "S7 (PSNV) ist für diese Organisation nicht eingeschaltet".into(),
        ));
    }
    match (f.bezeichnung_pflicht(), text) {
        (true, None) => Err(AppError::UnprocessableEntity(format!(
            "{} braucht eine Bezeichnung",
            f.standard_label()
        ))),
        (false, Some(_)) => Err(AppError::UnprocessableEntity(format!(
            "{} trägt keine Bezeichnung",
            f.kuerzel().unwrap_or_default()
        ))),
        (_, text) => Ok(Funktionsangabe {
            funktion: Some(f),
            text: text.map(str::to_string),
        }),
    }
}

/// Liest eine gespeicherte Angabe (Code-Spalte + Text-Spalte) zurück. Ein unbekannter Code
/// kann wegen des CHECK nicht vorkommen; er fiele auf Freitext zurück statt zu scheitern.
pub fn aus_spalten(code: Option<&str>, text: Option<String>) -> Funktionsangabe {
    Funktionsangabe {
        funktion: code.and_then(Fuehrungsfunktion::parse),
        text,
    }
}

#[cfg(test)]
mod tests;
