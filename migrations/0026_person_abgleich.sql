-- Vermisstenabgleich (Verdacht → bestätigt/verworfen). Höchstens EIN bestätigter
-- Abgleich je Vermisstmeldung (partieller Unique-Index).
CREATE TABLE person_abgleich (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id        INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    vermisst_person_id INTEGER NOT NULL REFERENCES einsatz_person(id),  -- Status vermisst
    gefunden_person_id INTEGER NOT NULL REFERENCES einsatz_person(id),  -- Status betroffen|verstorben
    status            TEXT    NOT NULL DEFAULT 'verdacht'
                      CHECK (status IN ('verdacht','bestaetigt','verworfen')),
    erstellt_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erstellt_von      INTEGER NOT NULL REFERENCES benutzer(id),
    entschieden_at    TEXT,
    entschieden_von   INTEGER REFERENCES benutzer(id),
    CHECK (vermisst_person_id <> gefunden_person_id),
    CHECK ((entschieden_at IS NULL) = (entschieden_von IS NULL)),
    CHECK (status = 'verdacht' OR entschieden_at IS NOT NULL)
);
CREATE UNIQUE INDEX idx_person_abgleich_bestaetigt
    ON person_abgleich (vermisst_person_id) WHERE status = 'bestaetigt';
CREATE INDEX idx_person_abgleich_einsatz ON person_abgleich (einsatz_id);
CREATE INDEX idx_person_abgleich_gefunden ON person_abgleich (gefunden_person_id);
