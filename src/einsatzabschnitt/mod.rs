pub mod repo;

use serde::Serialize;

/// Aufgelöste Abschnitts-Anzeige (flach; der Baum wird im FE über
/// `ueber_abschnitt_id` gebaut), inkl. aufgelöstem Leiter-Namen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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
    pub sprechgruppe_tmo: Option<String>,
    pub sprechgruppe_dmo: Option<String>,
    pub kommunikationsmittel: Option<String>,
    pub erreichbarkeit: Option<String>,
    pub sortier: i64,
}
