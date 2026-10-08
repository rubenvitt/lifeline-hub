-- LFH-1049: wann die Frist einer Datenkategorie am Einsatz zuletzt gesetzt wurde.
--
-- Phase K1 des Purge-Laufs rechnet den Karenz-Beginn ab dem Ablauf der Kategorie-Frist, nicht
-- ab dem Lauf, der vormerkt: `vorgemerkt_at = MIN(jetzt, MAX(frist_bis, frist_gesetzt_at,
-- abgeschlossen_at))`. Wurde die Frist in die Vergangenheit gesetzt, zählt der Zeitpunkt des
-- Setzens. NULL heißt unbekannt; dann gilt wie bisher der Lauf selbst. Dasselbe Muster wie
-- 0149 für die Frist des Einsatzes.
--
-- Befüllung: jede Kategorie mit Frist, ohne Vormerkung und ohne Schwärzung gilt als vor dem
-- Fristablauf gesetzt, höchstens jetzt. Die Migration läuft auch auf einer zurückgespielten
-- Sicherung von vor diesem Update und schließt dort die Lücke.

ALTER TABLE einsatz_aufbewahrung_kategorie ADD COLUMN frist_gesetzt_at TEXT;

UPDATE einsatz_aufbewahrung_kategorie
   SET frist_gesetzt_at = MIN(frist_bis, datetime('now'))
 WHERE frist_bis IS NOT NULL AND vorgemerkt_at IS NULL AND geschwaerzt_at IS NULL;
