-- LFH-35: Bild-Hintergründe der Lagekarte (Lageplan/Grundriss/Skizze als Overlay).
-- Einsatz-scoped, mehrere pro Einsatz. BLOB in SQLite (Vorbild anhang/0052) —
-- ein Container, VACUUM-INTO-Backup erfasst die Bilder mit. Hard-Delete via CASCADE.
-- ecken_json: JSON-Array von 4 [lng,lat]-Paaren (MapLibre image-source Reihenfolge).
-- Stil (Opazität/Sichtbarkeit/Reihenfolge) am Datensatz; Modul-Sichtbarkeit über "lagekarte".
CREATE TABLE karte_hintergrundbild (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    daten           BLOB    NOT NULL,
    mime            TEXT    NOT NULL,
    groesse         INTEGER NOT NULL,
    sha256          TEXT    NOT NULL,
    ecken_json      TEXT    NOT NULL,
    opazitaet       INTEGER NOT NULL DEFAULT 100 CHECK (opazitaet BETWEEN 0 AND 100),
    sichtbar        INTEGER NOT NULL DEFAULT 1   CHECK (sichtbar IN (0, 1)),
    reihenfolge     INTEGER NOT NULL DEFAULT 0,
    hochgeladen_von INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    geaendert_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_karte_hintergrundbild_einsatz ON karte_hintergrundbild(einsatz_id);
