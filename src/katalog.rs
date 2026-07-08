//! Geteilte Katalog-Grundlagen für Status-Kataloge (Fahrzeug, Personal, später Material).
//! Die feste Semantik-Kategorie trägt die App-Logik (Verfügbarkeit); der Dienststatus
//! steuert den Soft-Delete eines Stamm-Datensatzes.

use serde::Serialize;
use utoipa::ToSchema;

/// Dienststatus im Stamm: aktiv vs. außer Dienst (Soft-Delete).
pub const DIENSTSTATUS_IN_DIENST: &str = "in_dienst";
pub const DIENSTSTATUS_AUSSER_DIENST: &str = "ausser_dienst";

/// Semantik-Kategorie eines Status-Katalog-Eintrags (feste App-Logik).
pub const KATEGORIE_VERFUEGBAR: &str = "verfuegbar";
pub const KATEGORIE_GEBUNDEN: &str = "gebunden";
pub const KATEGORIE_NICHT_VERFUEGBAR: &str = "nicht_verfuegbar";

/// Ob `s` eine gültige Status-Kategorie ist (Eingabe-Validierung).
pub fn ist_gueltige_kategorie(s: &str) -> bool {
    matches!(s, KATEGORIE_VERFUEGBAR | KATEGORIE_GEBUNDEN | KATEGORIE_NICHT_VERFUEGBAR)
}

/// Betriebsart einer TETRA-Sprechgruppe.
pub const BETRIEBSART_TMO: &str = "TMO";
pub const BETRIEBSART_DMO: &str = "DMO";

/// Gültige Betriebsart einer Sprechgruppe (TETRA: TMO = Netz, DMO = Direkt).
pub fn ist_gueltige_betriebsart(s: &str) -> bool {
    matches!(s, BETRIEBSART_TMO | BETRIEBSART_DMO)
}

/// Betriebsart einer TETRA-Sprechgruppe (Schema-Anker für die OpenAPI-Union, LFH-120).
/// Wire == `betriebsart` (per-Variante, Großbuchstaben — `rename_all` trifft nicht).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub enum Betriebsart {
    #[serde(rename = "TMO")]
    Tmo,
    #[serde(rename = "DMO")]
    Dmo,
}

/// Status-Kategorie eines Katalog-Eintrags (Schema-Anker für die OpenAPI-Union, LFH-120).
/// Wire == `status_kategorie`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum StatusKategorie {
    Verfuegbar,
    Gebunden,
    NichtVerfuegbar,
}

/// Dienststatus im Stamm (Schema-Anker für die OpenAPI-Union, LFH-120). Wire == `dienststatus`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Dienststatus {
    InDienst,
    AusserDienst,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kategorie_validierung() {
        assert!(ist_gueltige_kategorie("gebunden"));
        assert!(!ist_gueltige_kategorie("irgendwas"));
    }

    #[test]
    fn betriebsart_validierung() {
        assert!(ist_gueltige_betriebsart("TMO"));
        assert!(ist_gueltige_betriebsart("DMO"));
        assert!(!ist_gueltige_betriebsart("FOO"));
        assert!(!ist_gueltige_betriebsart("tmo"));
    }
}
