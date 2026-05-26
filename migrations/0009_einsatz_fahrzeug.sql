-- Disposition: Zuordnung von Stamm-/Ad-hoc-Fahrzeugen zu einem konkreten Einsatz.
-- Referenz + Einsatz-Zustand (kein Voll-Snapshot des Stamms), plus Identitäts-
-- Schnappschuss (snap_*) für Nachvollziehbarkeit / Ad-hoc-Daten.
CREATE TABLE einsatz_fahrzeug (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    fahrzeug_id     INTEGER REFERENCES fahrzeug(id),         -- NULL = Ad-hoc extern
    status_id       INTEGER REFERENCES fahrzeug_status(id),  -- aktueller Einsatz-Status
    -- Identitäts-Schnappschuss (eingefroren beim Disponieren);
    -- bei Ad-hoc-extern sind dies die eigentlichen Daten:
    snap_funkrufname         TEXT NOT NULL,
    snap_kennzeichen         TEXT,
    snap_fahrzeugtyp         TEXT,
    snap_opta                TEXT,
    snap_traegerorganisation TEXT,
    bemerkung       TEXT,
    disponiert_at   TEXT NOT NULL DEFAULT (datetime('now')),
    disponiert_von  INTEGER REFERENCES benutzer(id),
    UNIQUE(einsatz_id, fahrzeug_id)   -- ein Stamm-Fahrzeug je Einsatz nur einmal; mehrere NULL erlaubt
);

CREATE INDEX idx_einsatz_fahrzeug_einsatz ON einsatz_fahrzeug(einsatz_id);
