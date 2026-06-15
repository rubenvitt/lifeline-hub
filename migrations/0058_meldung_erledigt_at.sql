-- Erledigt-Zeitpunkt an Meldung (LFH-113): Abgeschlossen-Ansicht zeigt einen echten
-- Erledigt-Stempel statt der Bestätigungszeit. Additive nullable TEXT-Spalte (UTC
-- 'YYYY-MM-DD HH:MM:SS' wie die übrigen *_at-Spalten); first-write-wins im Code beim
-- Übergang nach status='erledigt'. NULL für Bestand und solange nie erledigt.
-- ADD COLUMN ohne DEFAULT/CHECK → kein Table-Rebuild (meldung hat kein FTS/Trigger).
ALTER TABLE meldung ADD COLUMN erledigt_at TEXT;
