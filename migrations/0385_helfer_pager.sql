-- Helfer-App Stufe 2 (Pager, Zunder c19brpvf, Spec
-- docs/superpowers/specs/2026-11-25-c19brpvf-helfer-pager-design.md, ADR-0104).
--
-- 1. `helfer_push_anmeldung`: die Push-Anmeldung der iOS-Helfer-App, je Helfer-Kopplung höchstens
--    eine, mit der Kopplung gelöscht. Kein Verweis auf Benutzer oder Sitzung.
-- 2. `auftrag_empfaenger.helfer_gesendet`: an wie viele Helfer-Apps die Zeile ging. NULL heißt:
--    noch nicht an Helfer ausgeliefert (Bestand, und neue Zeilen bis zur Zustellung); die
--    Berichtigung erkennt daran die neuen Zeilen (`helfer::pager`).

CREATE TABLE helfer_push_anmeldung (
    kopplung_id  INTEGER PRIMARY KEY REFERENCES geraet_kopplung(id) ON DELETE CASCADE,
    kennung      TEXT    NOT NULL,
    token        TEXT    NOT NULL,
    umgebung     TEXT    NOT NULL CHECK (umgebung IN ('sandbox', 'production')),
    schluessel   BLOB    NOT NULL,
    angelegt_at  TEXT    NOT NULL
);

ALTER TABLE auftrag_empfaenger ADD COLUMN helfer_gesendet INTEGER;
