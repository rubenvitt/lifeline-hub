//! Demo-Daten zur Laufzeit (LFH-690): ein Übungseinsatz samt Stammdaten, den der System-Admin
//! seiner Organisation einspielt und wieder entfernt.
//!
//! **Nur mit Schalter.** Die Routen existieren ausschließlich mit `--demo-daten`
//! (`app::RouterOptionen`); ohne ihn antwortet `/api/demo-daten` wie ein unbekannter Pfad.
//!
//! Dieses Modul trägt die Antwortformen, den Import [`import::importieren_tx`], den Löschweg
//! [`entfernen::entfernen_tx`], die Stammdaten-Anlage
//! [`stammdaten::stammdaten_importieren_tx`] mit dem Katalog-Lookup [`katalog`] und das
//! Szenario samt Drehbuch als reine Daten ([`szenario`]). Der Bericht liegt als JSON am
//! Import-Kopf, deshalb sind die Typen auch `Deserialize`.
//!
//! Spec: `openspec/changes/lfh-690-demo-daten-laufzeit-import/`

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub mod entfernen;
pub mod import;
pub mod katalog;
pub mod stammdaten;
pub mod szenario;

#[cfg(test)]
mod entfernen_tests;
#[cfg(test)]
mod import_tests;
#[cfg(test)]
mod schema_tests;
#[cfg(test)]
mod stammdaten_tests;
#[cfg(test)]
mod test_hilfen;

/// Stand der Demo-Daten einer Organisation — die eine Antwort aller Demo-Endpunkte.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct DemoDatenStatus {
    /// Ob für die Organisation ein aktiver Import besteht.
    pub importiert: bool,
    /// Der aktive Import; fehlt, wenn keiner besteht.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub import: Option<DemoImportKopf>,
    /// Bericht des letzten Vorgangs (Import oder Entfernen); fehlt, wenn es keinen gab.
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

/// Ergebnis eines Imports oder eines Entfernens, je Stammdatenart.
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

/// Vorgang, den ein Bericht beschreibt. Wire == `as_str()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DemoVorgang {
    Importiert,
    Entfernt,
}

impl DemoVorgang {
    pub fn as_str(&self) -> &'static str {
        match self {
            DemoVorgang::Importiert => "importiert",
            DemoVorgang::Entfernt => "entfernt",
        }
    }
}

/// Stammdatenart im Bericht. Wire == `as_str()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DemoStammdatenArt {
    Fahrzeug,
    Personal,
    Material,
}

impl DemoStammdatenArt {
    pub fn as_str(&self) -> &'static str {
        match self {
            DemoStammdatenArt::Fahrzeug => "fahrzeug",
            DemoStammdatenArt::Personal => "personal",
            DemoStammdatenArt::Material => "material",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Der Bericht liegt später als JSON in der DB — Hin- und Rückweg müssen verlustfrei sein.
    #[test]
    fn bericht_round_trip_ueber_json() {
        let status = DemoDatenStatus {
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
            serde_json::from_str::<DemoDatenStatus>(&json).unwrap(),
            status
        );
    }

    /// Optionale Felder fehlen im Wire, statt `null` zu tragen (LFH-265) — und eine Antwort
    /// ohne sie liest sich zurück.
    #[test]
    fn nicht_importiert_ohne_optionale_felder() {
        let status = DemoDatenStatus {
            importiert: false,
            import: None,
            bericht: None,
        };
        let v = serde_json::to_value(&status).unwrap();
        let o = v.as_object().unwrap();
        assert!(!o.contains_key("import"));
        assert!(!o.contains_key("bericht"));
        assert_eq!(
            serde_json::from_value::<DemoDatenStatus>(v).unwrap(),
            status
        );
    }
}
