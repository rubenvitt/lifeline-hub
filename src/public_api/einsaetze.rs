//! Leserouten für Einsätze unter `/api/v1/` (LLH-1655, Spec `ereignis-abruf`, Herleitung
//! `openspec/changes/umeqho2b-outbox-ereignis-abruf/design.md`, D7 und D11).

/// Die Spalten von `einsatz`, aus denen der Einsatz der öffentlichen API entsteht. Ändert sich
/// eine davon an einem freigegebenen laufenden Einsatz, schreibt der Trigger
/// `einsatz_ereignis_kopf` ein `einsatz.updated`; er hört auf genau diese Spalten (Abgleich in
/// `tests/public_api_ereignis_trigger.rs`). Ein neues Feld im Schema `Einsatz` kommt mit seiner
/// Spalte hier dazu, und eine neue Migration baut den Trigger neu (`src/AGENTS.md`,
/// Ausgangsereignisse für Fremdsysteme).
pub const KOPF_SPALTEN: &[&str] = &[
    "einsatznummer_intern",
    "bezeichnung",
    "stichwort",
    "einsatzart",
    "leitstellen_nr",
    "einsatzort",
    "einsatzort_lat",
    "einsatzort_lon",
    "begonnen_at",
];
