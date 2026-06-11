-- Gemeinsamer Kommunikations-Unterbau (LFH-84). Zwei getrennte Achsen:
--  * kommunikation_zustellung  — Achse 1, PRO EMPFÄNGER (Lesebestätigung, z. B. Chat)
--  * kommunikation_status      — Quittung (Achse 1, pro Objekt) + Vollzug (Achse 2)
-- Polymorphe Referenz (objekt_typ, objekt_id) → kein DB-FK auf die Inhaltstabelle;
-- Integrität/Isolation wird im Code geprüft (org_id + einsatz_id in jeder Query).

CREATE TABLE kommunikation_zustellung (
    id            INTEGER PRIMARY KEY,
    org_id        INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    objekt_typ    TEXT    NOT NULL,
    objekt_id     INTEGER NOT NULL,
    empfaenger_id INTEGER NOT NULL REFERENCES benutzer(id),
    zugestellt_at TEXT,
    gelesen_at    TEXT
);
CREATE UNIQUE INDEX idx_komm_zustellung_objekt_empf
    ON kommunikation_zustellung(objekt_typ, objekt_id, empfaenger_id);
CREATE INDEX idx_komm_zustellung_einsatz
    ON kommunikation_zustellung(einsatz_id, objekt_typ, objekt_id);

CREATE TABLE kommunikation_status (
    id               INTEGER PRIMARY KEY,
    org_id           INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    objekt_typ       TEXT    NOT NULL,
    objekt_id        INTEGER NOT NULL,
    -- Achse 1: Quittung ("zur Kenntnis genommen").
    quittiert_at     TEXT,
    quittiert_von_id INTEGER REFERENCES benutzer(id),
    -- Achse 2: Vollzug ("ausgeführt"): 'offen' | 'in_arbeit' | 'vollzogen'.
    vollzug_status   TEXT    NOT NULL DEFAULT 'offen',
    vollzogen_at     TEXT,
    vollzogen_von_id INTEGER REFERENCES benutzer(id)
);
CREATE UNIQUE INDEX idx_komm_status_objekt
    ON kommunikation_status(objekt_typ, objekt_id);
CREATE INDEX idx_komm_status_einsatz
    ON kommunikation_status(einsatz_id, objekt_typ, objekt_id);
