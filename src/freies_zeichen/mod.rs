pub mod pruefung;
pub mod repo;

use serde::Serialize;
use utoipa::ToSchema;

/// Ein freies taktisches Zeichen (Punkt-Marker ohne Fachobjekt, LFH-170).
///
/// Die Form steht allein in `zeichen_spec` (LFH-836; seit LLH-1160 Pflicht, die Altspalten sind
/// entfernt). Lage-Snapshots von vorher tragen noch die Altform; der Client übersetzt sie beim
/// Lesen (design.md D5).
#[derive(Debug, Clone, PartialEq, Serialize, ToSchema)]
pub struct FreiesZeichenAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub lat: f64,
    pub lon: f64,
    /// Kanonische Zeichenbeschreibung von `@einsatzzeichen` (`serializeAnySpec`), unverändert wie
    /// gesendet. Bei einem Zeichen aus der Zeit vor LFH-836 die Hülle `{"v":1,"alt":{…}}` mit den
    /// Altwerten (Migration 0190, LLH-1160), bis es das nächste Mal geändert wird.
    pub zeichen_spec: String,
    pub label: Option<String>,
    /// Ansichts-Zugehörigkeit (LFH-320): `None` = auf allen Ansichten sichtbar.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ansicht_id: Option<i64>,
    pub erstellt_von: i64,
    pub erstellt_at: String,
    pub geaendert_at: String,
}
