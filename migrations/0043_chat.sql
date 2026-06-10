-- Einsatzinterner Chat (LFH-50): niederschwellige Abstimmung pro Einsatz.
-- Kanäle sind frei anlegbar; ein Default-Kanal wird serverseitig sichergestellt.
-- Nachrichten sind bearbeitbar und soft-löschbar (Tombstone via geloescht_at);
-- der verbindliche/unveränderliche Datensatz entsteht erst beim Heraufstufen ins ETB.
CREATE TABLE chat_kanal (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    beschreibung    TEXT,
    erstellt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    archiviert_at   TEXT
);
CREATE INDEX idx_chat_kanal_einsatz ON chat_kanal(einsatz_id);

CREATE TABLE chat_nachricht (
    id             INTEGER PRIMARY KEY,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    kanal_id       INTEGER NOT NULL REFERENCES chat_kanal(id) ON DELETE CASCADE,
    autor_id       INTEGER NOT NULL REFERENCES benutzer(id),
    inhalt         TEXT    NOT NULL,
    erstellt_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    bearbeitet_at  TEXT,
    geloescht_at   TEXT,
    -- Heraufstufungs-Rückverweis (NULL = reine Chat-Nachricht). Snapshot:
    -- spätere Bearbeitungen der Nachricht wirken NICHT auf den ETB-Eintrag.
    etb_eintrag_id INTEGER REFERENCES etb_eintrag(id)
);
CREATE INDEX idx_chat_nachricht_kanal ON chat_nachricht(kanal_id, id DESC);
