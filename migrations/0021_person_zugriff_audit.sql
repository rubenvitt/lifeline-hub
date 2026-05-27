-- Lese-Audit auf Personen-Detailzugriffe und Exporte (append-only — das Repo
-- bietet bewusst KEIN UPDATE/DELETE). person_id ist NULL beim Export der
-- gesamten Liste. Listen-Reads werden NICHT auditiert (SSE-Refetch-Lärm).
CREATE TABLE person_zugriff_audit (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id  INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id   INTEGER REFERENCES einsatz_person(id),  -- NULL bei Export gesamter Liste
    benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
    art         TEXT    NOT NULL CHECK (art IN ('detail','export')),
    zugriff_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);

CREATE INDEX idx_person_audit_einsatz ON person_zugriff_audit (einsatz_id, zugriff_at);
