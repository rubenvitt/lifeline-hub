-- LLH-1082: Bedarf einer Betreuungsstelle als Nachforderung mit Stellenbezug.
--
-- Eine Nachforderung kann auf die Betreuungsstelle verweisen, für die sie angefordert wurde
-- (Feldbetten, Decken, Dolmetscher …). Der Bedarf bleibt eine Nachforderung („Eine
-- Mengenwahrheit“, LFH-553): die Stelle selbst trägt kein Bedarfsfeld. Gesetzt nur beim Anlegen;
-- die Gleichheit des Einsatzes und den Lebenszyklus (storniert 409) prüft die Route. Der Storno
-- einer Stelle löst den Bezug im Code (`nachforderung::repo::loese_betreuungsstelle_tx`).
--
-- ADD COLUMN ohne CHECK: kein Rebuild. `ON DELETE SET NULL` wie `einsatz_material.nachforderung_id`
-- (0198): Stellen gehen nur mit dem Einsatz, und der Bezug darf das Löschen nicht aufhalten.
-- Bestand ohne Bezug. Abgesichert von db::tests::migration_0231_*.
ALTER TABLE nachforderung ADD COLUMN betreuungsstelle_id INTEGER
    REFERENCES betreuungsstelle(id) ON DELETE SET NULL;

CREATE INDEX idx_nachforderung_betreuungsstelle ON nachforderung(betreuungsstelle_id)
    WHERE betreuungsstelle_id IS NOT NULL;
