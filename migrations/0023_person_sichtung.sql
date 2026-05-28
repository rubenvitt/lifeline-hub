-- Sichtungs-Verlauf (append-only — kein UPDATE/DELETE). Jede (Re-)Sichtung ein
-- Eintrag; das denormalisierte einsatz_person.aktuelle_sichtung spiegelt den jüngsten.
CREATE TABLE person_sichtung (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id     INTEGER NOT NULL REFERENCES einsatz_person(id),
    kategorie     TEXT    NOT NULL
                  CHECK (kategorie IN ('sk1','sk2','sk3','sk4','tot','unverletzt')),
    notiz         TEXT,                       -- optionale Kurzbegründung zum Sichtungszeitpunkt
    gesichtet_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    gesichtet_von INTEGER NOT NULL REFERENCES benutzer(id)
);
CREATE INDEX idx_person_sichtung_person ON person_sichtung (person_id, gesichtet_at);
