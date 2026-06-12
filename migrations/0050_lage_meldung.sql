-- Lageobjekt aus lagerelevanter Meldung (LFH-95). Eigene Schnittstelle (nicht ETB),
-- Rückverweis auf die Quell-Meldung (Herkunft am Lageobjekt nachvollziehbar). Geo
-- optional — eine Meldung hat oft keine Koordinaten. UNIQUE(meldung_id): genau ein
-- Lageobjekt je Meldung (Übergabe idempotent).
CREATE TABLE lage_meldung (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    meldung_id      INTEGER NOT NULL REFERENCES meldung(id) ON DELETE CASCADE,
    text            TEXT    NOT NULL,
    lat             REAL,
    lon             REAL,
    erstellt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (meldung_id)
);
CREATE INDEX idx_lage_meldung_einsatz ON lage_meldung(einsatz_id);
