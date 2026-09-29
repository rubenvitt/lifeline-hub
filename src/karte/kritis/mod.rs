//! KRITIS-Fachebene aus dem Deutschland-OSM-Extrakt (LFH-83).
//!
//! Ein Hintergrund-Job liest periodisch den Geofabrik-Extrakt (`extrakt`), legt die Objekte als
//! eigenen Bestand in der Nachschlage-Cache-DB ab (`bestand`), und die Route beantwortet jede
//! bbox daraus, bei vielen Objekten verdichtet. Herleitung:
//! `openspec/changes/…/lfh-83-kritis-bundesweit-extrakt/design.md`.

pub mod bestand;
pub mod extrakt;
pub mod scheduler;

/// Attribution der Ebene — ODbL verlangt sie zwingend.
pub const KRITIS_ATTRIB: &str = "© OpenStreetMap-Beitragende (ODbL)";
