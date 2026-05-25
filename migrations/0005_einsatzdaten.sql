-- Kopf-/Stammdatenfelder des Einsatzes (Modul „Einsatzdaten").
-- Alle neuen Spalten sind nullable außer einsatzart.
--
-- Hinweis SQLite: ALTER TABLE ADD COLUMN erlaubt KEINE nicht-konstanten
-- Defaults (z. B. datetime('now')). angelegt_at bekommt daher konstant '' und
-- wird unten für Bestandszeilen auf begonnen_at zurückgesetzt; neue Zeilen
-- setzen den Wert explizit in repo::anlegen.
ALTER TABLE einsatz ADD COLUMN einsatzart TEXT NOT NULL DEFAULT 'realeinsatz'
    CHECK (einsatzart IN ('realeinsatz', 'uebung', 'sanitaetsdienst', 'bereitstellung'));
ALTER TABLE einsatz ADD COLUMN einsatznummer_intern TEXT;
ALTER TABLE einsatz ADD COLUMN angelegt_at TEXT NOT NULL DEFAULT '';
ALTER TABLE einsatz ADD COLUMN leitstellen_nr TEXT;
ALTER TABLE einsatz ADD COLUMN einsatzort TEXT;
ALTER TABLE einsatz ADD COLUMN einsatzort_lat REAL;
ALTER TABLE einsatz ADD COLUMN einsatzort_lon REAL;
ALTER TABLE einsatz ADD COLUMN meldende_stelle TEXT;
ALTER TABLE einsatz ADD COLUMN sachverhalt TEXT;
ALTER TABLE einsatz ADD COLUMN anzahl_betroffene_initial INTEGER;

-- Bestands-Einsätze: angelegt_at auf begonnen_at zurücksetzen
-- (nächste bekannte technische Zeit; Original-Anlagezeitpunkt unbekannt).
UPDATE einsatz SET angelegt_at = begonnen_at;

-- Einsatznummer je Organisation eindeutig. In SQLite gelten mehrere NULL als
-- verschieden → Bestands-Einsätze ohne Nummer kollidieren nicht.
CREATE UNIQUE INDEX idx_einsatz_nummer ON einsatz(org_id, einsatznummer_intern);
