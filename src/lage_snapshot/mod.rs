//! Lage-Snapshots (LFH-321): manuell ausgelöster, unveränderlicher Stand des vollen Lagebilds
//! eines Einsatzes. Das Dokument (`daten`) friert die rohen `*Anzeige`-DTOs der
//! Lagekarte-Quellen ein, damit spätere Änderungen an Entitäten den Stand nicht berühren. Ein
//! JSON-Dokument je Snapshot mit `schema_version`; einsatzweit, unabhängig von Kartenansichten.
//!
//! **Unveränderlichkeit:** nach dem Anlegen sind `daten`, `stand_at` und `erstellt_*` nicht mehr
//! schreibbar; ein PATCH berührt nur `bezeichnung`/`notiz`.

pub mod repo;

use serde::Serialize;
use utoipa::ToSchema;

/// Metadaten eines Snapshots — **ohne** das `daten`-Dokument (Listen-Response; `daten` kann
/// je Stand ~100 KB groß sein und gehört nicht in die Liste).
#[derive(Debug, Serialize, ToSchema)]
pub struct LageSnapshotAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezeichnung: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notiz: Option<String>,
    pub stand_at: String,
    pub schema_version: i64,
    pub erstellt_von: i64,
    pub erstellt_at: String,
}

/// Volldokument eines Snapshots inkl. eingefrorenem Lagebild (`daten`) — Einzel-Response.
#[derive(Debug, Serialize, ToSchema)]
pub struct LageSnapshotDokument {
    pub id: i64,
    pub einsatz_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezeichnung: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notiz: Option<String>,
    pub stand_at: String,
    pub schema_version: i64,
    pub erstellt_von: i64,
    pub erstellt_at: String,
    /// Eingefrorenes Lagebild (rohe `*Anzeige`-DTO-Listen, `schema_version = 1`).
    pub daten: serde_json::Value,
}
