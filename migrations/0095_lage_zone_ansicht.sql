-- LFH-320: Ansichts-Zugehörigkeit für Lage-Zonen. Additive Spalte (kein CHECK-Rebuild,
-- s. 0094). ansicht_id = NULL = auf allen Ansichten sichtbar (Bestand bleibt sichtbar).
-- ON DELETE SET NULL gibt die Zone bei Ansichts-Löschung (objekte=freigeben) frei.
ALTER TABLE lage_zone ADD COLUMN ansicht_id INTEGER
    REFERENCES karten_ansicht(id) ON DELETE SET NULL;
