//! KRITIS-Fachebene aus dem Deutschland-OSM-Extrakt (LFH-83).
//!
//! Bis LFH-83 fragte die Route je Karten-Viewport die öffentliche Overpass-API ab — erst ab
//! Zoom 10, höchstens 1° × 1°, und jeder neue Ausschnitt war eine weitere Anfrage an eine
//! fremde Fair-Use-Instanz. Jetzt liest ein Hintergrund-Job periodisch den Geofabrik-Extrakt
//! (`extrakt`), legt die Objekte als eigenen Bestand in der Nachschlage-Cache-DB ab
//! (`bestand`) und die Route beantwortet jede bbox daraus, bei vielen Objekten verdichtet.
//! Entscheidungen und verworfene Alternativen: `openspec/changes/…/lfh-83-kritis-bundesweit-extrakt/design.md`.

pub mod bestand;
pub mod extrakt;
pub mod scheduler;

/// Attribution der Ebene — ODbL verlangt sie zwingend.
pub const KRITIS_ATTRIB: &str = "© OpenStreetMap-Beitragende (ODbL)";
