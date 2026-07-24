-- LFH-320: Ansichts-Zugehörigkeit für Karten-Hintergrundbilder. Additive Spalte (kein
-- CHECK-Rebuild, s. 0094). ansicht_id = NULL = auf allen Ansichten sichtbar (Bestand
-- bleibt sichtbar). ON DELETE SET NULL gibt das Bild bei Ansichts-Löschung frei.
ALTER TABLE karte_hintergrundbild ADD COLUMN ansicht_id INTEGER
    REFERENCES karten_ansicht(id) ON DELETE SET NULL;
