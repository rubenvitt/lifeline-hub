-- ETB-Lesemarke je Benutzer und Einsatz (LFH-611): „14 neue Einträge seit Ihrer letzten
-- Sichtung um 13:04 · alle als gesichtet markieren" (Neuentwurf S4).
--
-- EINE Zeile je (Einsatz, Benutzer), nicht je Eintrag: die Lesebestätigung des Chats
-- (`kommunikation_zustellung.gelesen_at`) steht je Objekt × Empfänger — für ein Tagebuch
-- mit Hunderten Einträgen die falsche Kardinalität, und „bis hierher gesichtet" ist eine
-- Grenze, keine Menge.
--
-- Verglichen wird über `gesichtet_lfd_nr`, angezeigt wird `gesichtet_at`. `lfd_nr` wächst
-- je Einsatz streng mit dem EINGANG (0004_etb.sql); `ereigniszeit` kann nachgetragen sein.
-- Eine Marke als Zeitpunkt ließe einen nachgetragenen Eintrag still darunter rutschen.
--
-- Kein `org_id`: die Organisation hängt am Einsatz und wird nicht zweimal geführt
-- (F05/LFH-232, dieselbe Begründung wie 0099_benutzer_einstellungen).
--
-- ON DELETE CASCADE auf beide Seiten: eine Marke ohne Einsatz oder ohne Benutzer hat
-- keinen Leser mehr.
CREATE TABLE etb_lesemarke (
    einsatz_id        INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    benutzer_id       INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    gesichtet_lfd_nr  INTEGER NOT NULL,
    gesichtet_at      TEXT    NOT NULL,
    PRIMARY KEY (einsatz_id, benutzer_id)
);
