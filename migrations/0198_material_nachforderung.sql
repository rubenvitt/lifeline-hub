-- LLH-1226: Bezug Nachforderung → Material (Change mspu3hvb-nachforderung-material, design.md D4).
--
-- Ein Materialposten verweist auf die Nachforderung, aus der er übernommen wurde; eine
-- Nachforderung kann mehrere Posten tragen (Teillieferungen, ein Gerät je Stück). ADD COLUMN statt
-- Neubau: über die Spalte läuft kein CHECK, die Gleichheit des Einsatzes prüft der Code (wie bei
-- `verpflegung_ausgabe`, 0120). Die Migration liegt nach dem Neubau aus 0197, der die Spalte
-- sonst verlöre. `ON DELETE SET NULL` wie 0120: Nachforderungen gehen nur mit dem Einsatz, und der
-- Bezug darf das Löschen nicht aufhalten. Bestand ohne Bezug (keine Herleitung aus Bezeichnungen).
-- Abgesichert von db::tests::migration_0198_*.
ALTER TABLE einsatz_material ADD COLUMN nachforderung_id INTEGER
    REFERENCES nachforderung(id) ON DELETE SET NULL;

CREATE INDEX idx_einsatz_material_nachforderung ON einsatz_material(nachforderung_id)
    WHERE nachforderung_id IS NOT NULL;
