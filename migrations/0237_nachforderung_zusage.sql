-- LLH-1097 (Teil a): Zusage mit Menge, Rufnamen und voraussichtlichem Eintreffen, Teilzusage als
-- Aufteilung, Zurückziehen durch die eigene Führung (design.md D1–D3, D8, D12).
--
-- Nur ADD COLUMN, kein Neubau: `status` trägt keinen CHECK (0056, 0235), der neue Wert
-- 'zurueckgezogen' prüft der Code (`NachforderungStatus`). Der CHECK „höchstens ein Ziel“ aus 0235
-- bleibt unberührt. ADD COLUMN mit REFERENCES ist erlaubt, weil die Spalte ohne Vorgabe NULL ist.
--
-- zusage_rufnamen        JSON-Array der Rufnamen bzw. freien Angaben der Zusage, NULL = keine.
-- eintreffen_erwartet_at voraussichtliches Eintreffen laut Zusage (UTC wie angefordert_at).
-- anzahl_angefordert     bei einer Teilzusage die Anzahl vor der Teilung („1 von 2 zugesagt“).
-- teilung_aus_id         Restposition einer Teilzusage → die zugesagte Nachforderung. SET NULL wie
--                        die übrigen Bezüge; Nachforderungen gehen nur mit dem Einsatz.
-- zurueckgezogen_at/_grund  Zurückziehen durch die eigene Führung (terminal).
-- Abgesichert von db::tests::migration_0237_*.

ALTER TABLE nachforderung ADD COLUMN zusage_rufnamen TEXT;
ALTER TABLE nachforderung ADD COLUMN eintreffen_erwartet_at TEXT;
ALTER TABLE nachforderung ADD COLUMN anzahl_angefordert INTEGER;
ALTER TABLE nachforderung ADD COLUMN teilung_aus_id INTEGER
    REFERENCES nachforderung(id) ON DELETE SET NULL;
ALTER TABLE nachforderung ADD COLUMN zurueckgezogen_at TEXT;
ALTER TABLE nachforderung ADD COLUMN zurueckgezogen_grund TEXT;

CREATE INDEX idx_nachforderung_teilung ON nachforderung(teilung_aus_id)
    WHERE teilung_aus_id IS NOT NULL;
