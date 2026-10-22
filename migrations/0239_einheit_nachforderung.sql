-- LLH-1383 (Teil b zu LLH-1097): eine eingetroffene Nachforderung als Einheit übernehmen
-- (design.md D7). Die Einheit trägt ihre Herkunft; die Nachforderung liest ihre Einheiten über
-- diesen Verweis (`einheit_ids`), und solange einer besteht, ist die Rücknahme aus „eingetroffen“
-- gesperrt (D8, Muster `einsatz_material.nachforderung_id`, LLH-1226).
--
-- Nur ADD COLUMN, kein Neubau: ADD COLUMN mit REFERENCES ist erlaubt, weil die Spalte ohne
-- Vorgabe NULL ist. SET NULL wie die übrigen Bezüge auf `nachforderung`; Nachforderungen gehen
-- nur mit dem Einsatz.
-- Abgesichert von db::tests::migration_0239_*.

ALTER TABLE einsatz_einheit ADD COLUMN nachforderung_id INTEGER
    REFERENCES nachforderung(id) ON DELETE SET NULL;

CREATE INDEX idx_einsatz_einheit_nachforderung ON einsatz_einheit(nachforderung_id)
    WHERE nachforderung_id IS NOT NULL;
