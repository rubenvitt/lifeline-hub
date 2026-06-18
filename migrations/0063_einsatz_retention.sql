-- Datenschutz & Aufbewahrung (LFH-130) — Retention-Foundation.
-- Die kritischste Pre-Mortem-Maßnahme: die Spalten existieren VOR dem ersten
-- Echteinsatz, damit später keine rückwirkende Migration nötig ist.
--
-- retention_bis: Zeitpunkt (TEXT, '%Y-%m-%d %H:%M:%S' UTC), ab dem ein
--   ABGESCHLOSSENER Einsatz nicht mehr lesbar ist (Lese-Sperre in
--   einsatz::berechtigung::darf_lesen). NULL = keine Frist (Verhalten wie bisher).
--   Greift nie auf aktive Einsätze. Auto-Befüllung beim Abschluss + Purge sind
--   bewusst NICHT Teil dieser Migration (eigenes Archiv-Feature, LFH-135).
-- geloescht_at: Soft-Delete-Tombstone (TEXT, gleiches Format). Wird hier nur
--   angelegt; das Kippen (Scheduler-Purge, Karenz) folgt im Archiv-Feature.
--   Namens-Konvention `_at` (wie chat.geloescht_at) — Löschung, nicht
--   `storniert_at` (Fehleingabe-Storno).
--
-- ADD COLUMN ohne CHECK/NOT-NULL → kein Tabellen-Rebuild trotz 35 Inbound-FKs.
ALTER TABLE einsatz ADD COLUMN retention_bis TEXT;
ALTER TABLE einsatz ADD COLUMN geloescht_at  TEXT;
