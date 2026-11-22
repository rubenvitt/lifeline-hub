-- iOS-Push über das Relais (APNs): Anmeldungen je Gerät, Zugang zum Relais, Kopplungsmerkmal.
CREATE TABLE ios_push_anmeldung (
    id                 INTEGER PRIMARY KEY,
    kennung            TEXT    NOT NULL UNIQUE,
    benutzer_id        INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    session_token_hash TEXT REFERENCES session(token_hash) ON DELETE SET NULL,
    token              TEXT    NOT NULL UNIQUE,
    umgebung           TEXT    NOT NULL CHECK (umgebung IN ('sandbox', 'production')),
    schluessel         TEXT    NOT NULL,
    inhalt             INTEGER NOT NULL DEFAULT 0 CHECK (inhalt IN (0, 1)),
    stumm              TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(stumm) AND json_type(stumm) = 'array'),
    erstellt_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX idx_ios_push_anmeldung_benutzer ON ios_push_anmeldung(benutzer_id);
CREATE INDEX idx_ios_push_anmeldung_session ON ios_push_anmeldung(session_token_hash);

CREATE TABLE ios_push_relais (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    server_id   TEXT NOT NULL,
    geheimnis   TEXT NOT NULL,
    gesperrt_at TEXT,
    erstellt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

ALTER TABLE instanz_kopplung ADD COLUMN gegenueber_ios_push INTEGER NOT NULL DEFAULT 0;
