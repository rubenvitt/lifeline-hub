-- Transport/Verbleib (append-only). Das jüngste Ereignis füllt
-- einsatz_person.aktueller_verbleib (Kurzform). Krankenhaus/Ziel = Freitext.
CREATE TABLE person_verbleib (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id      INTEGER NOT NULL REFERENCES einsatz_person(id),
    art            TEXT    NOT NULL
                   CHECK (art IN ('transport','entlassung','vor_ort','verstorben')),
    transportmittel TEXT,                     -- Freitext (RTW, KTW, …), optional
    ziel           TEXT,                      -- Freitext-Krankenhaus/Ziel, optional
    status         TEXT
                   CHECK (status IS NULL OR status IN ('angemeldet','abtransportiert')),
    notiz          TEXT,
    zeitpunkt_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von    INTEGER NOT NULL REFERENCES benutzer(id)
);
CREATE INDEX idx_person_verbleib_person ON person_verbleib (person_id, zeitpunkt_at);
