-- LFH-320: Ansichts-Zugehörigkeit für freie taktische Zeichen. Additive Spalte —
-- SQLite erlaubt REFERENCES beim ADD COLUMN, solange der Default NULL ist → kein
-- CHECK-Rebuild (Präzedenz: die karten_ansicht-Spalten selbst). ansicht_id = NULL
-- heißt „auf allen Ansichten sichtbar"; der Bestand landet dort und bleibt sichtbar.
-- ON DELETE SET NULL: wird die Ansicht gelöscht (objekte=freigeben), fällt das Zeichen
-- automatisch auf „alle Ansichten" zurück statt zu verwaisen.
ALTER TABLE freies_zeichen ADD COLUMN ansicht_id INTEGER
    REFERENCES karten_ansicht(id) ON DELETE SET NULL;
