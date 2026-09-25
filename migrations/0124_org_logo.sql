-- LFH-22 (design.md D8): Logo der Organisation für Druckkopf und Oberfläche.
--
-- Eigene 1:1-Tabelle statt Spalten an `organisation`: kein Tabellen-Rebuild, der BLOB
-- bleibt aus jeder Abfrage der Stammdaten heraus, und „kein Logo" ist die fehlende Zeile.
-- `anhang` scheidet aus: einsatzgebunden, fiele in die Schwärzungsmenge.
--
-- Keine `einsatz_id`, kein CASCADE-Pfad zu `einsatz`: die Tabelle liegt außerhalb der
-- Schwärzung (Guard in `einsatz::schwaerzung_registry`).
CREATE TABLE org_logo (
    org_id          INTEGER PRIMARY KEY REFERENCES organisation(id) ON DELETE CASCADE,
    mime            TEXT    NOT NULL CHECK (mime IN ('image/png', 'image/jpeg')),
    groesse         INTEGER NOT NULL CHECK (groesse BETWEEN 1 AND 1048576),
    sha256          TEXT    NOT NULL,
    daten           BLOB    NOT NULL,
    hochgeladen_von INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    geaendert_at    TEXT    NOT NULL
);
