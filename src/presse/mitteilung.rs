//! Pressemitteilung (LFH-554): dritte Art des Vorlagendokuments neben Lagebericht und Befehl.
//!
//! Entwurf, Freigabe mit ETB-Snapshot (`meldung`: eine ausgehende Meldung an die
//! Öffentlichkeit, nicht `entscheidung` — die Sprungmarke „Entscheidungen“ füllte sich sonst mit
//! Pressetexten) und Fortschreibung laufen über den gemeinsamen Kern
//! [`crate::vorlagendokument`]. **Freigeben darf nur die Einsatzleitung:** das Gate sitzt an der
//! Route (`EinsatzLeitungszugriff<Stab>`), der Kern bleibt für alle Arten gleich.
//!
//! Suchhinweise (Personenfahndung) sind bewusst keine Vorlage: sie sind Sache der Polizei und
//! trügen personenbezogene Beschreibungen in einen öffentlichen Text (design.md Non-Goals).

use crate::vorlagendokument::repo::Dokument;
use crate::vorlagendokument::{self as kern, AbschnittDef, Abschnittsart, Dokumentart, VorlageDef};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Vorlage einer Pressemitteilung (Schema-Anker für die OpenAPI-Union). Wire == `vorlage`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PressemitteilungVorlage {
    Erstinformation,
    Folgeinformation,
    Bevoelkerungshinweis,
    Freitext,
}

/// Status einer Pressemitteilung (Schema-Anker für die OpenAPI-Union). Wire == `status`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PressemitteilungStatus {
    Entwurf,
    Freigegeben,
}

const NAECHSTE_INFORMATION: AbschnittDef = AbschnittDef {
    schluessel: "naechste_information",
    label: "Nächste Information",
};
const RUECKFRAGEN: AbschnittDef = AbschnittDef {
    schluessel: "rueckfragen",
    label: "Rückfragen",
};
const HINWEISE: AbschnittDef = AbschnittDef {
    schluessel: "hinweise",
    label: "Hinweise an die Bevölkerung",
};
const MASSNAHMEN: AbschnittDef = AbschnittDef {
    schluessel: "massnahmen",
    label: "Maßnahmen",
};

/// Vorlagen-Registry. MUSS synchron zu `frontend/src/presse/vorlagen.ts` gehalten werden
/// (Schlüssel + Reihenfolge; Paar-Test im Frontend).
pub const VORLAGEN: &[VorlageDef] = &[
    VorlageDef {
        schluessel: "erstinformation",
        label: "Erstinformation",
        abschnitte: &[
            AbschnittDef {
                schluessel: "sachverhalt",
                label: "Sachverhalt",
            },
            MASSNAHMEN,
            HINWEISE,
            NAECHSTE_INFORMATION,
            RUECKFRAGEN,
        ],
    },
    VorlageDef {
        schluessel: "folgeinformation",
        label: "Folgeinformation",
        abschnitte: &[
            AbschnittDef {
                schluessel: "neue_entwicklung",
                label: "Neue Entwicklung",
            },
            MASSNAHMEN,
            HINWEISE,
            NAECHSTE_INFORMATION,
            RUECKFRAGEN,
        ],
    },
    VorlageDef {
        schluessel: "bevoelkerungshinweis",
        label: "Hinweis an die Bevölkerung",
        abschnitte: &[
            AbschnittDef {
                schluessel: "gefahr",
                label: "Gefahr",
            },
            AbschnittDef {
                schluessel: "gebiet",
                label: "Betroffenes Gebiet",
            },
            AbschnittDef {
                schluessel: "verhaltenshinweise",
                label: "Verhaltenshinweise",
            },
            AbschnittDef {
                schluessel: "weitere_informationen",
                label: "Weitere Informationen",
            },
        ],
    },
    VorlageDef {
        schluessel: "freitext",
        label: "Freie Mitteilung",
        abschnitte: &[AbschnittDef {
            schluessel: "text",
            label: "Mitteilung",
        }],
    },
];

/// Marker der Dokumentart Pressemitteilung.
pub struct Pressemitteilung;

impl Dokumentart for Pressemitteilung {
    type Abschnitt = Abschnitt;
    type Anzeige = PressemitteilungAnzeige;
    const TABELLE: &'static str = "pressemitteilung";
    const ETB_TYP: &'static str = crate::etb::TYP_MELDUNG;
    const ETB_VERWEIS: &'static str = "pressemitteilung_id";
    const VORLAGEN: &'static [VorlageDef] = VORLAGEN;
    const NOMEN: &'static str = "Pressemitteilung";
    const NOMEN_PLURAL: &'static str = "Pressemitteilungen";
    const NOMEN_MIT_ARTIKEL: &'static str = "Die Pressemitteilung";
    const IM_NOMEN: &'static str = "in der Pressemitteilung";
}

/// Liefert die Vorlagendefinition zu einem Schlüssel, `None` bei Unbekanntem.
pub fn vorlage(schluessel: &str) -> Option<&'static VorlageDef> {
    kern::vorlage::<Pressemitteilung>(schluessel)
}

/// Ein gefüllter Abschnitt (so persistiert als JSON-Array-Element).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[schema(as = PressemitteilungAbschnitt)]
pub struct Abschnitt {
    pub schluessel: String,
    pub text: String,
}

impl Abschnittsart for Abschnitt {
    fn neu(schluessel: String, text: String) -> Self {
        Self { schluessel, text }
    }
    fn schluessel(&self) -> &str {
        &self.schluessel
    }
    fn text(&self) -> &str {
        &self.text
    }
}

/// Öffentliche Anzeige einer Pressemitteilung.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct PressemitteilungAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    #[schema(value_type = PressemitteilungVorlage)]
    pub vorlage: String,
    pub titel: String,
    pub zeitstand: String,
    #[schema(value_type = PressemitteilungStatus)]
    pub status: String,
    pub abschnitte: Vec<Abschnitt>,
    pub version: i64,
    pub vorgaenger_id: Option<i64>,
    pub ersteller_id: i64,
    pub ersteller_name: String,
    pub erstellt_at: String,
    pub aktualisiert_at: String,
    pub freigegeben_von_id: Option<i64>,
    pub freigegeben_von_name: Option<String>,
    pub freigegeben_at: Option<String>,
    pub etb_eintrag_id: Option<i64>,
}

impl From<Dokument<Abschnitt>> for PressemitteilungAnzeige {
    fn from(d: Dokument<Abschnitt>) -> Self {
        Self {
            id: d.id,
            einsatz_id: d.einsatz_id,
            vorlage: d.vorlage,
            titel: d.titel,
            zeitstand: d.zeitstand,
            status: d.status,
            abschnitte: d.abschnitte,
            version: d.version,
            vorgaenger_id: d.vorgaenger_id,
            ersteller_id: d.ersteller_id,
            ersteller_name: d.ersteller_name,
            erstellt_at: d.erstellt_at,
            aktualisiert_at: d.aktualisiert_at,
            freigegeben_von_id: d.freigegeben_von_id,
            freigegeben_von_name: d.freigegeben_von_name,
            freigegeben_at: d.freigegeben_at,
            etb_eintrag_id: d.etb_eintrag_id,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vorlagen_haben_erwartete_abschnitte() {
        let schluessel = |v: &str| -> Vec<&str> {
            vorlage(v)
                .unwrap()
                .abschnitte
                .iter()
                .map(|a| a.schluessel)
                .collect()
        };
        assert_eq!(
            schluessel("erstinformation"),
            [
                "sachverhalt",
                "massnahmen",
                "hinweise",
                "naechste_information",
                "rueckfragen"
            ]
        );
        assert_eq!(
            schluessel("folgeinformation"),
            [
                "neue_entwicklung",
                "massnahmen",
                "hinweise",
                "naechste_information",
                "rueckfragen"
            ]
        );
        assert_eq!(
            schluessel("bevoelkerungshinweis"),
            [
                "gefahr",
                "gebiet",
                "verhaltenshinweise",
                "weitere_informationen"
            ]
        );
        assert_eq!(schluessel("freitext"), ["text"]);
        assert!(
            vorlage("suchhinweis").is_none(),
            "Suchhinweise sind keine Vorlage"
        );
    }
}
