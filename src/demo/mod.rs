//! Demo-Daten zur Laufzeit (LFH-690): Übungslagen samt Stammdaten, die der System-Admin seiner
//! Organisation einspielt und wieder entfernt. Seit LLH-1576 gibt es zwei Lagen
//! ([`DemoLage`]), jede mit eigenem Kopf, die nebeneinander bestehen.
//!
//! **Nur mit Schalter.** Die Routen existieren ausschließlich mit `--demo-daten`
//! (`app::RouterOptionen`); ohne ihn antwortet `/api/demo-daten` wie ein unbekannter Pfad.
//!
//! Dieses Modul trägt die Antwortformen, den Import [`import::importieren_tx`], den Löschweg
//! [`entfernen::entfernen_tx`], die Stammdaten-Anlage
//! [`stammdaten::stammdaten_importieren_tx`] mit dem Katalog-Lookup [`katalog`] und das
//! Szenarien samt Drehbuch als reine Daten ([`szenario`], [`szenario_stadtfest`]). Der Bericht
//! liegt als JSON am Import-Kopf, deshalb sind die Typen auch `Deserialize`.
//!
//! Spec: `openspec/specs/demo-daten/spec.md`

use crate::wire_enum::wire_enum;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub mod entfernen;
pub mod import;
pub mod katalog;
pub mod stammdaten;
pub mod szenario;
pub mod szenario_stadtfest;

#[cfg(test)]
mod entfernen_tests;
#[cfg(test)]
mod import_tests;
#[cfg(test)]
mod schema_tests;
#[cfg(test)]
mod stadtfest_tests;
#[cfg(test)]
mod stammdaten_tests;
#[cfg(test)]
pub(crate) mod test_hilfen;

wire_enum! {
    /// Eine Demo-Lage (LLH-1576, design.md D1). Wire == `as_str()` == `demo_import.szenario`
    /// (CHECK in `migrations/0290_demo_import_szenario.sql`) == Pfadsegment der Routen.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
    pub enum DemoLage {
        /// „ÜBUNG – Starkregen Musterstadt“, die Lage aus LFH-690.
        Starkregen => "starkregen",
        /// „ÜBUNG – Sanitätsdienst Stadtfest Musterstadt“ (LLH-1576).
        Stadtfest => "stadtfest",
    }
}

impl DemoLage {
    /// Das Szenario der Lage: Stammdaten, Kopfdaten und Drehbuch.
    pub fn szenario(&self) -> &'static szenario::Szenario {
        match self {
            DemoLage::Starkregen => &szenario::STARKREGEN,
            DemoLage::Stadtfest => &szenario_stadtfest::STADTFEST,
        }
    }
}

/// Stand der Demo-Daten einer Organisation — die eine Antwort aller Demo-Endpunkte: je Lage ein
/// Eintrag, immer alle Lagen in der Reihenfolge von [`DemoLage::ALLE`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct DemoDatenStatus {
    pub lagen: Vec<DemoLageStatus>,
}

/// Stand einer Lage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct DemoLageStatus {
    pub lage: DemoLage,
    /// Ob für die Organisation ein aktiver Import dieser Lage besteht.
    pub importiert: bool,
    /// Der aktive Import; fehlt, wenn keiner besteht.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub import: Option<DemoImportKopf>,
    /// Bericht des letzten Vorgangs (Import oder Entfernen) dieser Lage; fehlt, wenn es keinen
    /// gab.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bericht: Option<DemoBericht>,
}

/// Kopf eines aktiven Imports.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct DemoImportKopf {
    pub id: i64,
    /// UTC ohne Zonenkennung (`YYYY-MM-DD HH:MM:SS`).
    pub importiert_at: String,
    pub einsatz_id: i64,
    pub einsatz_bezeichnung: String,
}

/// Ergebnis eines Imports oder eines Entfernens, je Stammdatenart (Fahrzeug, Personal, Material,
/// Einheiten-Vorlage).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct DemoBericht {
    pub vorgang: DemoVorgang,
    /// UTC ohne Zonenkennung (`YYYY-MM-DD HH:MM:SS`).
    pub zeitpunkt: String,
    pub je_art: Vec<DemoBerichtZeile>,
}

/// Zahlen einer Stammdatenart. Beim Import zählen `angelegt` und `mitbenutzt`, beim
/// Entfernen `entfernt` und `behalten`; die übrigen stehen auf 0.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct DemoBerichtZeile {
    pub art: DemoStammdatenArt,
    /// Neu angelegt und mit der Demo-Marke versehen.
    pub angelegt: i64,
    /// Vorhandener Datensatz derselben Kennung, unverändert mitbenutzt.
    pub mitbenutzt: i64,
    /// Beim Entfernen gelöscht.
    pub entfernt: i64,
    /// Beim Entfernen stehen gelassen, weil noch anderswo verwiesen; die Marke fällt.
    pub behalten: i64,
}

wire_enum! {
    /// Vorgang, den ein Bericht beschreibt. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum DemoVorgang {
        Importiert => "importiert",
        Entfernt => "entfernt",
    }
}

wire_enum! {
    /// Stammdatenart im Bericht. Wire == `as_str()`.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
    pub enum DemoStammdatenArt {
        Fahrzeug => "fahrzeug",
        Personal => "personal",
        Material => "material",
        EinheitVorlage => "einheit_vorlage",
        /// Schichtmodell der Ablösung (LLH-1122).
        Schichtmodell => "schichtmodell",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Der Bericht liegt später als JSON in der DB — Hin- und Rückweg müssen verlustfrei sein.
    #[test]
    fn bericht_round_trip_ueber_json() {
        let status = DemoLageStatus {
            lage: DemoLage::Stadtfest,
            importiert: true,
            import: Some(DemoImportKopf {
                id: 1,
                importiert_at: "2026-09-24 10:00:00".into(),
                einsatz_id: 7,
                einsatz_bezeichnung: "ÜBUNG – Starkregen".into(),
            }),
            bericht: Some(DemoBericht {
                vorgang: DemoVorgang::Importiert,
                zeitpunkt: "2026-09-24 10:00:00".into(),
                je_art: vec![DemoBerichtZeile {
                    art: DemoStammdatenArt::Fahrzeug,
                    angelegt: 3,
                    mitbenutzt: 1,
                    entfernt: 0,
                    behalten: 0,
                }],
            }),
        };
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(
            serde_json::from_str::<DemoLageStatus>(&json).unwrap(),
            status
        );
    }

    /// Jede Lage nennt ihr eigenes Szenario, und der Wire-Wert ist der CHECK der Migration.
    #[test]
    fn lagen_und_szenarien_passen_zusammen() {
        assert_eq!(
            DemoLage::ALLE.map(|l| l.as_str()),
            ["starkregen", "stadtfest"]
        );
        for lage in DemoLage::ALLE {
            assert_eq!(lage.szenario().lage, lage);
            assert_eq!(DemoLage::parse(lage.as_str()), Some(lage));
        }
    }

    /// Optionale Felder fehlen im Wire, statt `null` zu tragen (LFH-265) — und eine Antwort
    /// ohne sie liest sich zurück.
    #[test]
    fn nicht_importiert_ohne_optionale_felder() {
        let status = DemoLageStatus {
            lage: DemoLage::Starkregen,
            importiert: false,
            import: None,
            bericht: None,
        };
        let v = serde_json::to_value(&status).unwrap();
        let o = v.as_object().unwrap();
        assert!(!o.contains_key("import"));
        assert!(!o.contains_key("bericht"));
        assert_eq!(serde_json::from_value::<DemoLageStatus>(v).unwrap(), status);
    }
}
