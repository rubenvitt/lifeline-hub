pub mod repo;

use crate::sprechgruppe::SprechgruppeAnzeige;
use serde::Serialize;
use utoipa::ToSchema;

/// Lagezustand eines Abschnitts (LFH-608), Wire == `lagezustand`. Die Beurteilung trifft
/// die Führung; ohne Beurteilung bleibt das Feld leer — „nicht beurteilt" ist KEIN
/// planmäßig. Die Farbe liegt im Frontend-Vertrag (`theme/statusFarben.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AbschnittLagezustand {
    Planmaessig,
    Angespannt,
    Kritisch,
}

impl AbschnittLagezustand {
    /// DB-/API-Stringrepräsentation.
    pub fn as_str(&self) -> &'static str {
        match self {
            AbschnittLagezustand::Planmaessig => "planmaessig",
            AbschnittLagezustand::Angespannt => "angespannt",
            AbschnittLagezustand::Kritisch => "kritisch",
        }
    }

    /// Parst einen gespeicherten/übergebenen Wert; `None` bei unbekanntem Wert.
    pub fn parse(s: &str) -> Option<AbschnittLagezustand> {
        match s {
            "planmaessig" => Some(AbschnittLagezustand::Planmaessig),
            "angespannt" => Some(AbschnittLagezustand::Angespannt),
            "kritisch" => Some(AbschnittLagezustand::Kritisch),
            _ => None,
        }
    }

    /// Wortlaut für den ETB — lesbar, nicht der Wire-Wert.
    pub fn wort(&self) -> &'static str {
        match self {
            AbschnittLagezustand::Planmaessig => "planmäßig",
            AbschnittLagezustand::Angespannt => "angespannt",
            AbschnittLagezustand::Kritisch => "kritisch",
        }
    }
}

/// Aufgelöste Abschnitts-Anzeige (flach; der Baum wird im FE über
/// `ueber_abschnitt_id` gebaut), inkl. aufgelöstem Leiter-Namen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, ToSchema)]
pub struct EinsatzabschnittAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub ueber_abschnitt_id: Option<i64>,
    pub name: String,
    pub leiter_id: Option<i64>,
    /// Name der disponierten Leiter-Person (aufgelöst), falls gesetzt.
    pub leiter_name: Option<String>,
    pub bemerkung: Option<String>,
    pub flaeche_geojson: Option<String>,
    pub tz_fachaufgabe: Option<String>,
    pub tz_organisation: Option<String>,
    /// Historischer Freitext-Wert (eingefroren; nicht mehr schreibbar).
    pub sprechgruppe_tmo: Option<String>,
    /// Historischer Freitext-Wert (eingefroren; nicht mehr schreibbar).
    pub sprechgruppe_dmo: Option<String>,
    pub kommunikationsmittel: Option<String>,
    pub erreichbarkeit: Option<String>,
    pub sortier: i64,
    /// Kurzbezeichnung/Rufname im Einsatz, z. B. „EA-N" (LFH-608); je Einsatz eindeutig.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kurzbezeichnung: Option<String>,
    /// Beurteilter Lagezustand (LFH-608); fehlt = nicht beurteilt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lagezustand: Option<AbschnittLagezustand>,
    /// Fester Abschnittsauftrag als Freitext (LFH-608) — nicht zu verwechseln mit den
    /// einzelnen Aufträgen des Auftragsmoduls.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abschnittsauftrag: Option<String>,
    /// Eingeschätzter Fortschritt in Prozent, 0–100 (LFH-608); fehlt = nicht eingeschätzt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fortschritt: Option<i64>,
    /// Zugeordnete Sprechgruppen (aus Katalogeintrag oder einsatz-lokal).
    pub sprechgruppen: Vec<SprechgruppeAnzeige>,
}
