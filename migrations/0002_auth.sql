-- Organisation: in T1 genau eine pro Server (siehe Spec, Annahme Single-Org).
CREATE TABLE organisation (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    erstellt_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Lokale Benutzerkonten. system_rolle: 'admin' (serverweite Verwaltung) oder 'keiner'.
CREATE TABLE benutzer (
    id            INTEGER PRIMARY KEY,
    org_id        INTEGER NOT NULL REFERENCES organisation(id),
    anzeigename   TEXT NOT NULL,
    benutzername  TEXT NOT NULL UNIQUE,
    passwort_hash TEXT NOT NULL,
    system_rolle  TEXT NOT NULL DEFAULT 'keiner'
                  CHECK (system_rolle IN ('admin', 'keiner')),
    aktiv         INTEGER NOT NULL DEFAULT 1,
    erstellt_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Server-seitige Sessions; Token im httpOnly-Cookie. expires_at als ISO-Zeitstempel.
CREATE TABLE session (
    token       TEXT PRIMARY KEY,
    benutzer_id INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    erstellt_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL
);

CREATE INDEX idx_session_benutzer ON session(benutzer_id);
