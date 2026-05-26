-- Disposition: Zuordnung von Stamm-/Ad-hoc-Personen zu einem konkreten Einsatz.
-- Referenz + Einsatz-Status + Identitäts-Schnappschuss (snap_*). Bei Ad-hoc-extern
-- (personal_id IS NULL) sind die snap_*-Felder die eigentlichen Daten.
CREATE TABLE einsatz_personal (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    personal_id     INTEGER REFERENCES personal(id),         -- NULL = Ad-hoc extern
    status_id       INTEGER REFERENCES personal_status(id),  -- aktueller Einsatz-Status
    staerke_position TEXT                                    -- Dispo-Override (sonst Stamm-Default)
                    CHECK (staerke_position IN ('fuehrer', 'unterfuehrer', 'mannschaft')),
    snap_name                TEXT NOT NULL,
    snap_funktion            TEXT,    -- Qualifikationen/Funktion als flacher Text
    snap_traegerorganisation TEXT,
    bemerkung       TEXT,
    disponiert_at   TEXT NOT NULL DEFAULT (datetime('now')),
    disponiert_von  INTEGER REFERENCES benutzer(id),
    UNIQUE(einsatz_id, personal_id)   -- eine Stamm-Person je Einsatz nur einmal; mehrere NULL erlaubt
);

CREATE INDEX idx_einsatz_personal_einsatz ON einsatz_personal(einsatz_id);
