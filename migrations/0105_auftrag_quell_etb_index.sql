-- Folgeaufträge am ETB-Eintrag (LFH-636): die ETB-Abfrage lädt je Seite die Aufträge,
-- deren `quell_etb_eintrag_id` (0059) auf einen der geladenen Einträge zeigt
-- (`WHERE quell_etb_eintrag_id IN (…)`). Ohne Index ist das ein Scan über alle Aufträge
-- der Instanz bei jedem Laden des Tagebuchs.
--
-- Partiell: die allermeisten Aufträge entstehen nicht aus dem ETB und tragen NULL — sie
-- gehören nicht in den Index.
CREATE INDEX idx_auftrag_quell_etb
    ON auftrag (quell_etb_eintrag_id)
    WHERE quell_etb_eintrag_id IS NOT NULL;
