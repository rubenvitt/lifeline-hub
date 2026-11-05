-- LLH-1510 (Entscheidung LLH-1310 Punkt 3): Der Vermerk der entfallenen Planung (0259) hält
-- zusätzlich die ID der Einheit fest, deren Planung entfallen ist. Streicht man ihre Entlassung,
-- holt `abloesung::repo::restore_planungen_tx` die Planung an jeder laufenden Schicht zurück, deren
-- Vermerk noch Grund `entlassung` und diese Einheit trägt. Der Name allein (0259) taugt dafür
-- nicht: er ist eine Kopie zum Zeitpunkt des Entfallens.
--
-- Geschrieben und geräumt wie die drei Spalten aus 0259 (`drop_planungen_tx`, `set_abloeser_tx`,
-- `restore_planungen_tx`). Nur mit Vermerk (der CHECK aus 0259 hält die drei übrigen gemeinsam);
-- ein Vermerk ohne ID bleibt erlaubt: ältere Vermerke tragen keine und holen nichts zurück. Kein
-- Backfill. Wird die Einheit gelöscht, fällt nur die ID weg, der Vermerk bleibt.
ALTER TABLE einsatz_abloesung ADD COLUMN planung_entfallen_einheit_id INTEGER
    REFERENCES einsatz_einheit(id) ON DELETE SET NULL
    CHECK (planung_entfallen_einheit_id IS NULL OR planung_entfallen_grund IS NOT NULL);
