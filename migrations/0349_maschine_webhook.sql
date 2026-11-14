-- LLH-1656 (Change z6ds0ed9-webhooks-outbox, design.md D1): Webhooks als zweiter Leser der
-- Outbox `maschine_ereignis`. Höchstens ein Webhook je Maschinenzugang; er liest nur die Zeilen
-- seines Zugangs und schreibt nie in die Outbox (ADR-0038).

-- `id` ist zugleich `aud` der Signatur. `cursor` ist die Nummer des zuletzt zugestellten
-- Ereignisses; er rückt nur bei Erfolg vor (D2). „Fehler“ ist kein eigener Zustand, sondern
-- `aktiv` mit `fehler_seit`; „ruht“ wird aus dem Zugang abgeleitet (D1). `offen_id` ist die
-- Nummer des fälligen Ereignisses, das (noch) nicht zugestellt werden konnte: Liegt sie unter der
-- Löschgrenze der Outbox, ist es verloren (D2). `letzter_fehler_art` ist ein Code
-- (`WebhookFehler`), nie Text des Ziels.
CREATE TABLE maschine_webhook (
    id                    TEXT    PRIMARY KEY,
    zugang_id             TEXT    NOT NULL UNIQUE
                          REFERENCES maschinenzugang(id) ON DELETE CASCADE,
    url                   TEXT    NOT NULL,
    arten                 TEXT    NOT NULL,
    lan_erlaubt           INTEGER NOT NULL DEFAULT 0 CHECK (lan_erlaubt IN (0, 1)),
    zustand               TEXT    NOT NULL DEFAULT 'aktiv' CHECK (zustand IN ('aktiv', 'angehalten')),
    cursor                INTEGER NOT NULL,
    offen_id              INTEGER,
    fehler_seit           TEXT,
    fehlversuche          INTEGER NOT NULL DEFAULT 0,
    naechster_versuch_at  TEXT,
    letzter_fehler_at     TEXT,
    letzter_fehler_status INTEGER,
    letzter_fehler_art    TEXT,
    letzter_erfolg_at     TEXT,
    angehalten_at         TEXT,
    verlust_at            TEXT,
    angelegt_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    geaendert_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Die letzten Zustellversuche je Webhook (höchstens 50; wer einfügt, löscht die älteren).
-- `ereignis_id` ist NULL beim Testereignis. Kein Rumpf der Antwort (Spec „Diagnose“).
CREATE TABLE maschine_webhook_versuch (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_id  TEXT    NOT NULL REFERENCES maschine_webhook(id) ON DELETE CASCADE,
    at          TEXT    NOT NULL,
    ereignis_id INTEGER,
    test        INTEGER NOT NULL DEFAULT 0 CHECK (test IN (0, 1)),
    status      INTEGER,
    fehler_art  TEXT,
    dauer_ms    INTEGER NOT NULL
);
CREATE INDEX idx_maschine_webhook_versuch ON maschine_webhook_versuch (webhook_id, id);
