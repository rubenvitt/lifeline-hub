-- LLH-1388 (Nachzug zu LLH-1383, design.md D2): was die Übernahme aus einer Nachforderung an
-- einer Einheit getan hat, damit der Storno einer Fehlübernahme genau das zurücknimmt.
-- `nachforderung_angelegt` = 1: die Übernahme hat die Einheit angelegt (der Storno löst sie auf);
-- 0: sie war schon da und wurde verknüpft (der Storno löst nur den Verweis).
-- `nachforderung_belegung_id`: der Eintritt, den die Übernahme im Raum des Ziels gebucht hat.
--
-- Nur ADD COLUMN: NOT NULL mit Vorgabe und REFERENCES ohne Vorgabe sind erlaubt. Bestand aus
-- LLH-1383 bleibt 0/NULL (der Storno löst dort nur den Verweis).
-- Abgesichert von db::tests::migration_0246_*.

ALTER TABLE einsatz_einheit ADD COLUMN nachforderung_angelegt INTEGER NOT NULL DEFAULT 0
    CHECK (nachforderung_angelegt IN (0, 1));

ALTER TABLE einsatz_einheit ADD COLUMN nachforderung_belegung_id INTEGER
    REFERENCES br_belegung(id) ON DELETE SET NULL;
