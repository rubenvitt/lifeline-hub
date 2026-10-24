-- LLH-1445 (Change o659va5r-nachforderung-herkunft, design.md D1): auf welchem Weg der Verweis
-- einer Einheit auf ihre Nachforderung entstanden ist. `nachforderung_am_raum` = 1: das Eintreffen
-- am Bereitstellungsraum hat ihn gesetzt (die Karte nennt die Einheit „am Raum eingetroffen“);
-- 0: die Übernahme oder kein Verweis. Der Storno setzt den Wert mit den anderen Herkunftsfeldern
-- (Migration 0246) zurück.
--
-- Nur ADD COLUMN mit Vorgabe: der Bestand bleibt 0 (die Karte zeigt ihn wie bisher).
-- Abgesichert von db::tests::migration_0250_*.

ALTER TABLE einsatz_einheit ADD COLUMN nachforderung_am_raum INTEGER NOT NULL DEFAULT 0
    CHECK (nachforderung_am_raum IN (0, 1));
