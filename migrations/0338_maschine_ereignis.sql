-- LLH-1655 (Change umeqho2b-outbox-ereignis-abruf, design.md D4): Outbox der Ausgangsereignisse
-- für Fremdsysteme an der öffentlichen API `/api/v1/` (ADR-0022). Hier nur die Tabellen; die
-- Trigger, die sie füllen, kommen in einer eigenen Migration hinter der Einsatzfreigabe für
-- Maschinenzugänge (LLH-1638).

-- Eine Zeile je Ereignis und Zugang. `id` ist der Cursor des Abrufs `GET /api/v1/events`:
-- AUTOINCREMENT vergibt eine Nummer nie neu, auch wenn die höchste Zeile gelöscht ist; der
-- Höchststand steht in `sqlite_sequence`. `type` und `occurred_at` heißen wie auf dem Wire
-- (`public_api::events::EventType`, Zeit in `zeit::FORMAT`). `einsatz_id` trägt keinen
-- Fremdschlüssel: das `einsatz.closed` eines gelöschten laufenden Einsatzes überlebt ihn.
-- Gefüllt nur von Triggern, kein Schreibweg in Rust.
CREATE TABLE maschine_ereignis (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    zugang_id   TEXT    NOT NULL REFERENCES maschinenzugang(id) ON DELETE CASCADE,
    type        TEXT    NOT NULL CHECK (type IN
                    ('einsatz.created', 'einsatz.updated', 'einsatz.closed', 'lage.changed')),
    einsatz_id  INTEGER NOT NULL,
    occurred_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
-- Abruf: die Zeilen eines Zugangs ab einem Cursor.
CREATE INDEX idx_maschine_ereignis_zugang ON maschine_ereignis (zugang_id, id);
-- Verdichtung von `lage.changed` und Aufräumen beim Löschen eines Einsatzes.
CREATE INDEX idx_maschine_ereignis_einsatz ON maschine_ereignis (einsatz_id, type, zugang_id);

-- Genau eine Zeile: bis zu welcher Nummer der Purge-Lauf gelöscht hat. Ein Cursor darunter ist
-- abgelaufen (`410 cursor_expired`).
CREATE TABLE maschine_ereignis_stand (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    purged_until INTEGER NOT NULL DEFAULT 0
);
INSERT INTO maschine_ereignis_stand (id) VALUES (1);
