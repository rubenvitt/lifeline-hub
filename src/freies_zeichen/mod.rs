pub mod pruefung;
pub mod repo;

use serde::Serialize;
use utoipa::ToSchema;

/// Ein freies taktisches Zeichen (Punkt-Marker ohne Fachobjekt, LFH-170).
///
/// Genau eine Form ist gesetzt (DB-CHECK, LFH-836): `zeichen_spec` (neu) ODER `grundzeichen` mit
/// den Overlays (Altform aus der Zeit vor LFH-836 bzw. von einem veralteten Client). Der Client
/// übersetzt die Altform beim Lesen (design.md D5).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct FreiesZeichenAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub lat: f64,
    pub lon: f64,
    /// Kanonische Zeichenbeschreibung von `@einsatzzeichen` (`serializeAnySpec`), unverändert wie
    /// gesendet; fehlt bei einem Zeichen in Altform.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zeichen_spec: Option<String>,
    /// Altform: fehlt bei einem Zeichen mit `zeichen_spec`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grundzeichen: Option<String>,
    pub organisation: Option<String>,
    pub fachaufgabe: Option<String>,
    pub symbol: Option<String>,
    pub einheit: Option<String>,
    pub funktion: Option<String>,
    pub farbe: Option<String>,
    pub label: Option<String>,
    /// Ansichts-Zugehörigkeit (LFH-320): `None` = auf allen Ansichten sichtbar.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ansicht_id: Option<i64>,
    pub erstellt_von: i64,
    pub erstellt_at: String,
    pub geaendert_at: String,
}
