-- LLH-1510 (Entscheidung LLH-1310 Punkt 3): Der Vermerk der entfallenen Planung (0259) hält
-- zusätzlich die Entlassung fest (Zeile der Kräfte-Zeitachse), mit der die Planung entfallen ist.
-- Wird genau diese Entlassung gestrichen, holt `abloesung::repo::restore_entfallene_planungen_tx`
-- die Planung an jeder laufenden Schicht zurück, deren Vermerk noch Grund `entlassung` und diese
-- Entlassung trägt. Die Einheit allein taugt dafür nicht: eine ältere, weiter geltende Entlassung
-- derselben Einheit kann an einer anderen Schicht noch ihren Vermerk tragen. Der Name (0259) erst
-- recht nicht: er ist eine Kopie zum Zeitpunkt des Entfallens.
--
-- Geschrieben und geräumt wie die drei Spalten aus 0259 (`drop_planungen_tx`, `set_abloeser_tx`,
-- `restore_entfallene_planungen_tx`). Nur mit Vermerk (der CHECK aus 0259 hält die drei übrigen
-- gemeinsam); ein Vermerk ohne Entlassung bleibt erlaubt: Auflösung und ältere Vermerke tragen
-- keine und holen nichts zurück. Kein Backfill.
ALTER TABLE einsatz_abloesung ADD COLUMN planung_entfallen_entlassung_id INTEGER
    REFERENCES einsatz_kraft_zeitachse(id) ON DELETE SET NULL
    CHECK (planung_entfallen_entlassung_id IS NULL OR planung_entfallen_grund IS NOT NULL);
