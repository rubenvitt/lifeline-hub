-- LLH-1295: Betreuungsstelle als dritter Empfänger einer Verpflegungsausgabe (LLH-1024 U4/F3,
-- design.md D1). Mengen, keine Personen: die Ausgabe trägt nur die Kennung der Stelle, ihre
-- Bezeichnung kommt aus der Empfängerliste von `GET …/verpflegung`.
--
-- „Höchstens ein Empfänger“ (Einheit, Abschnitt oder Betreuungsstelle) prüft weiter die Anwendung
-- (422 in `verpflegung::repo::ausgabe_erfassen_tx`); ein CHECK bräuchte einen Neubau der Tabelle
-- (siehe 0210). Den Lebenszyklus prüft ebenfalls die Anwendung: storniert gilt als nicht
-- vorhanden (404), geschlossen nimmt an. Der Storno einer Stelle löst den Bezug im Code
-- (`verpflegung::repo::loese_betreuungsstelle_tx`); `ON DELETE SET NULL` ist nur das Netz für das
-- Löschen des Einsatzes, wie bei `nachforderung.betreuungsstelle_id` (0231). Nur additiv: der
-- Bestand bleibt ohne Empfänger. Abgesichert von db::tests::migration_0259_*.
ALTER TABLE verpflegung_ausgabe ADD COLUMN betreuungsstelle_id INTEGER
    REFERENCES betreuungsstelle(id) ON DELETE SET NULL;

-- Lösen beim Storno und SET NULL beim Löschen; die meisten Ausgaben haben keinen Empfänger.
CREATE INDEX idx_verpflegung_ausgabe_betreuungsstelle ON verpflegung_ausgabe(betreuungsstelle_id)
    WHERE betreuungsstelle_id IS NOT NULL;
