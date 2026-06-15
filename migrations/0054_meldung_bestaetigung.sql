-- Sofortmeldung & Eskalation (LFH-85/96/97): bestätigungspflichtige Sofortmeldungen.
-- Additive Spalten (ADD COLUMN mit DEFAULT, kein Table-Rebuild → FTS/Trigger bleiben heil,
-- wie 0049). Code-validiert (kein DB-CHECK, Bestandsmuster prioritaet/status).
--
-- Die Bestätigung selbst (von/um) läuft NICHT über eine eigene Spalte, sondern über die
-- bestehende kommunikation_status-Quittungsachse (objekt_typ='meldung', quittiert_at/
-- quittiert_von_id) — spiegelt die Achsen-Trennung der Aufträge (LFH-84). Hier nur die
-- SOLL-/Eskalations-Felder, die dort keinen Slot haben.

-- 1 = aktiv zu bestätigen (gesetzt beim Absetzen einer Sofortmeldung bzw. per Flag).
ALTER TABLE meldung ADD COLUMN bestaetigung_pflicht INTEGER NOT NULL DEFAULT 0;
-- Absolute Bestätigungsfrist (UTC 'YYYY-MM-DD HH:MM:SS'); NULL wenn keine Pflicht.
ALTER TABLE meldung ADD COLUMN bestaetigung_frist_at TEXT;
-- 1 = Frist überschritten + unbestätigt (vom Erinnerungs-Tick gesetzt, Re-Highlight).
ALTER TABLE meldung ADD COLUMN eskaliert INTEGER NOT NULL DEFAULT 0;
