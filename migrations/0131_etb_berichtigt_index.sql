-- Berichtigungen am Grundeintrag (LFH-689): die ETB-Abfrage lädt je Seite die
-- Berichtigungen, deren `berichtigt_eintrag_id` (0004) auf einen der geladenen Einträge
-- zeigt (`WHERE berichtigt_eintrag_id IN (…)`). Ohne Index ist das ein Scan über alle
-- ETB-Einträge der Instanz bei jedem Laden des Tagebuchs.
--
-- Partiell: nur Berichtigungen tragen den Verweis, alle anderen Einträge tragen NULL und
-- gehören nicht in den Index.
CREATE INDEX idx_etb_berichtigt
    ON etb_eintrag (berichtigt_eintrag_id)
    WHERE berichtigt_eintrag_id IS NOT NULL;
