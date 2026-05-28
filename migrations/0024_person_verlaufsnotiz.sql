-- Medizinische Befund-/Verlaufsnotizen (append-only — besondere Kategorie).
-- Korrektur = neue Notiz. NIE ins ETB, nie in den SSE-Payload.
CREATE TABLE person_verlaufsnotiz (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id  INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id   INTEGER NOT NULL REFERENCES einsatz_person(id),
    text        TEXT    NOT NULL,
    erfasst_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von INTEGER NOT NULL REFERENCES benutzer(id)
);
CREATE INDEX idx_person_verlaufsnotiz_person ON person_verlaufsnotiz (person_id, erfasst_at);
