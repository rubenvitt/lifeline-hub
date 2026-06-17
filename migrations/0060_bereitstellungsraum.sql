-- E‑3: Kräfte-Bereitstellungsraum (BR) als einsatz-scoped Entity (analog UHS).
-- Status-Maschine: geplant → aktiv → aufgeloest (terminal).
-- Soft-Delete via storniert_at. Kein FK auf abschnitt (optional).
CREATE TABLE bereitstellungsraum (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    abschnitt_id  INTEGER REFERENCES einsatzabschnitt(id),
    bezeichnung   TEXT    NOT NULL,                  -- "BR Nord", "BR 1"
    standort      TEXT,                              -- Freitext
    notiz         TEXT,
    status        TEXT    NOT NULL DEFAULT 'geplant'
                  CHECK (status IN ('geplant','aktiv','aufgeloest')),
    erfasst_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von   INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_von INTEGER NOT NULL REFERENCES benutzer(id),
    storniert_at  TEXT,
    UNIQUE (einsatz_id, bezeichnung)
);
CREATE INDEX idx_br_einsatz ON bereitstellungsraum (einsatz_id, status);
CREATE INDEX idx_br_abschnitt ON bereitstellungsraum (abschnitt_id);
