-- LFH-906: wann die Aufbewahrungsfrist eines Einsatzes zuletzt gesetzt wurde.
--
-- Phase A des Purge-Laufs rechnet den Karenz-Beginn ab dem Ablauf der Frist, nicht ab dem Lauf,
-- der vormerkt: `geloescht_at = MIN(jetzt, MAX(retention_bis, retention_gesetzt_at))`. Wurde die
-- Frist in die Vergangenheit gesetzt, zählt der Zeitpunkt des Setzens. NULL heißt unbekannt; dann
-- gilt wie bisher der Lauf selbst.
--
-- Befüllung: jeder Einsatz mit Frist und ohne Vormerkung gilt als vor dem Fristablauf gesetzt,
-- höchstens jetzt. Die Migration läuft auch auf einer zurückgespielten Sicherung von vor diesem
-- Update und schließt dort die Lücke.
--
-- Herleitung: openspec/changes/lfh-906-restore-karenz-ab-fristablauf/design.md (D2, D3).

ALTER TABLE einsatz ADD COLUMN retention_gesetzt_at TEXT;

UPDATE einsatz
   SET retention_gesetzt_at = MIN(retention_bis, datetime('now'))
 WHERE retention_bis IS NOT NULL AND geloescht_at IS NULL;
