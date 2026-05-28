-- E‑3: Unfallhilfsstelle (PA, BHP, VSS, …) als einsatz-scoped Versorgungs-Struktur.
-- Kein globaler Stamm, keine Disposition. Typ ist ein festes Enum. abschnitt_id
-- optional (UHS-Leitung läuft implizit über den Abschnitt). Soft-Delete via
-- storniert_at; aufgeloest ist terminal (Status-Maschine).
CREATE TABLE uhs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    abschnitt_id  INTEGER REFERENCES einsatzabschnitt(id),
    typ           TEXT    NOT NULL
                  CHECK (typ IN ('patientenablage','behandlungsplatz',
                                 'verletztensammelstelle','bereitstellungsraum',
                                 'sonstige')),
    bezeichnung   TEXT    NOT NULL,                  -- "PA 1", "BHP 50"
    standort      TEXT,                              -- Freitext (Adresse/Hinweis)
    notiz         TEXT,
    status        TEXT    NOT NULL DEFAULT 'geplant'
                  CHECK (status IN ('geplant','aktiv','aufgeloest')),
    erfasst_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von   INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_von INTEGER NOT NULL REFERENCES benutzer(id),
    storniert_at  TEXT,                              -- Soft-Delete (Fehleingabe)
    UNIQUE (einsatz_id, bezeichnung)
);
CREATE INDEX idx_uhs_einsatz ON uhs (einsatz_id, status);
CREATE INDEX idx_uhs_abschnitt ON uhs (abschnitt_id);
