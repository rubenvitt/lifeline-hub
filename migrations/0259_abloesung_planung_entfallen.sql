-- LLH-1309 (Folge aus LLH-1131, Entwurf /mnt/project-files/llh-1309/design.md D1/D2): Vermerk
-- der zuletzt entfallenen Planung an der Schicht. Entfällt die Planung, weil die geplante
-- ablösende Einheit aufgelöst oder entlassen wurde (`abloesung::repo::drop_planungen_tx`), merkt
-- sich die Schicht Zeitpunkt, Grund und Namen der Einheit zu diesem Zeitpunkt (wie die ETB-Texte).
-- Jede Änderung der Ablöser-Liste räumt ihn (`set_abloeser_tx`). Nur der Code schreibt die Werte.
-- Alle drei sind gesetzt oder alle leer (CHECK an der letzten Spalte, die die beiden davor schon
-- sieht). Kein Backfill: ältere entfallene Planungen tragen keinen Vermerk.
ALTER TABLE einsatz_abloesung ADD COLUMN planung_entfallen_at TEXT;
ALTER TABLE einsatz_abloesung ADD COLUMN planung_entfallen_einheit_name TEXT;
ALTER TABLE einsatz_abloesung ADD COLUMN planung_entfallen_grund TEXT
    CHECK (
        (planung_entfallen_grund IS NULL
            AND planung_entfallen_at IS NULL
            AND planung_entfallen_einheit_name IS NULL)
        OR (planung_entfallen_grund IN ('aufloesung', 'entlassung')
            AND planung_entfallen_at IS NOT NULL
            AND planung_entfallen_einheit_name IS NOT NULL)
    );
