//! Stammdaten-Eingang (LLH-1633): Fahrzeuge, Personal und Qualifikationen aus einer neutralen
//! Datei (Vertrag „Stammdaten-Datei“). [`datei`] liest die Datei zu einem [`StammdatenPaket`],
//! [`abgleich`] gleicht rein ab, [`repo`] rechnet Vorschau und Übernehmen gegen die Datenbank.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::abloesung::schichtplan::uebernahme::MeldungStufe;
use crate::wire_enum::wire_enum;

pub mod abgleich;
pub mod datei;
pub mod repo;

wire_enum! {
    /// Art eines Stammdatensatzes. Wire == `as_str()`.
    #[derive(
        Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, ToSchema,
    )]
    #[schema(as = StammdatenDateiArt)]
    pub enum StammdatenArt {
        Fahrzeug => "fahrzeug",
        Personal => "personal",
        Qualifikation => "qualifikation",
    }
    try_from = |s| format!("Ungültige Art von Stammdaten: {s}");
}

/// Kennung und Herkunft, wie die Zeile der Datei sie nennt (roh, getrimmt, `None` = leer).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Herkunftsangabe {
    pub kennung: Option<String>,
    pub herkunft: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FahrzeugAngabe {
    pub zeile: u32,
    pub quelle: Herkunftsangabe,
    pub funkrufname: String,
    pub kennzeichen: Option<String>,
    pub opta: Option<String>,
    pub issi: Option<String>,
    pub typ: Option<String>,
    pub standort: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonalAngabe {
    pub zeile: u32,
    pub quelle: Herkunftsangabe,
    pub name: String,
    pub personalnummer: Option<String>,
    pub telefon: Option<String>,
    pub traegerorganisation: Option<String>,
    /// Kennungen der Quelle oder Bezeichnungen, aus einer `;`-Liste.
    pub qualifikationen: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QualifikationAngabe {
    pub zeile: u32,
    pub quelle: Herkunftsangabe,
    pub bezeichnung: String,
}

/// Was eine Datei an Stammdaten liefert, noch ohne Bezug zur Datenbank.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct StammdatenPaket {
    pub fahrzeuge: Vec<FahrzeugAngabe>,
    pub personal: Vec<PersonalAngabe>,
    pub qualifikationen: Vec<QualifikationAngabe>,
}

/// Fehler oder Hinweis beim Lesen; `art` und `zeile` nur, wenn es sie gibt.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct DateiMeldung {
    #[schema(value_type = Option<StammdatenArt>)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub art: Option<StammdatenArt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zeile: Option<u32>,
    #[schema(value_type = MeldungStufe)]
    pub stufe: MeldungStufe,
    pub text: String,
}
