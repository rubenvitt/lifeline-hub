-- LFH-1028: Bild-Anlagen an Lagebericht und Befehl (Spec `dokument-anlagen`). Erster Anwender
-- ist die Fernmeldeskizze: der Browser zeichnet ihre Druckform als PNG, das hier als fester
-- Stand neben dem Text liegt. Die Bytes liegen in `anhang` (BLOB, AV-Scan, Bereinigung,
-- Vorschau, Backup); je Dokumentart ein Linker, 1:1 (anhang_id UNIQUE).
--
-- REGISTEREINTRAG PFLICHT: beide Tabellen stehen in `anhang::repo::MODUL_LINKER`. Ohne den
-- Eintrag gälte eine Anlage als „ungebunden“: der Sweep löschte sie nach 24 h, und die
-- ablegende Person könnte sie über die generische Route laden und hart löschen.
--
-- anhang_id ON DELETE CASCADE: die Schwärzung (Einsatz oder Kategorie `anhaenge`) löscht die
-- Datei im Nachlauf, der Linker geht mit. Die Anlage hat keinen Soft-Delete: entfernt wird nur
-- im Entwurf, und ein Entwurf ist noch kein Beleg (anders als die Erfassungs-Anhänge mit
-- ETB-Nachweis). Nach der Freigabe ist sie unveränderlich; das prüft die Route und das
-- Repo (Status `entwurf` im selben Schreibvorgang).
--
-- `art` ist erweiterbar: ein späterer Anwender (Lagekarte, Organigramm) ergänzt den CHECK per
-- Rebuild. `stand_at` ist der Zeitpunkt der Aufnahme (SQLite-Zeit), derselbe, der im Bild als
-- „Stand“ steht. `reihenfolge` zählt je Dokument ab 1 und bestimmt die Anlagen-Nummer.
CREATE TABLE lagebericht_anlage (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    lagebericht_id  INTEGER NOT NULL REFERENCES lagebericht(id) ON DELETE CASCADE,
    anhang_id       INTEGER NOT NULL UNIQUE REFERENCES anhang(id) ON DELETE CASCADE,
    art             TEXT    NOT NULL CHECK (art IN ('fernmeldeskizze')),
    titel           TEXT    NOT NULL,
    stand_at        TEXT    NOT NULL,
    reihenfolge     INTEGER NOT NULL,
    abgelegt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    abgelegt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (lagebericht_id, reihenfolge)
);
CREATE INDEX idx_lagebericht_anlage_einsatz ON lagebericht_anlage(einsatz_id);

CREATE TABLE befehl_anlage (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    befehl_id       INTEGER NOT NULL REFERENCES befehl(id) ON DELETE CASCADE,
    anhang_id       INTEGER NOT NULL UNIQUE REFERENCES anhang(id) ON DELETE CASCADE,
    art             TEXT    NOT NULL CHECK (art IN ('fernmeldeskizze')),
    titel           TEXT    NOT NULL,
    stand_at        TEXT    NOT NULL,
    reihenfolge     INTEGER NOT NULL,
    abgelegt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    abgelegt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (befehl_id, reihenfolge)
);
CREATE INDEX idx_befehl_anlage_einsatz ON befehl_anlage(einsatz_id);
