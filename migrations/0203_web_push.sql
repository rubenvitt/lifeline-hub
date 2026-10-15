-- LLH-1223: Web Push bei geschlossenem Tab (Change hotzhx58-web-push, design.md D2/D3).
--
-- `web_push_schluessel`: das VAPID-Schlüsselpaar der Instanz, genau eine Zeile (CHECK id = 1).
-- Erzeugt beim ersten Start mit `--web-push`; es liegt in der DB, damit die Sicherung es
-- mitnimmt und nach einer Wiederherstellung alle Abos gültig bleiben. Privater Schlüssel als
-- PKCS#8-DER, öffentlicher als unkomprimierter Punkt (65 Byte), beide Base64url ohne Auffüllung.
CREATE TABLE web_push_schluessel (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    privat      TEXT NOT NULL,
    oeffentlich TEXT NOT NULL,
    erstellt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- `web_push_abo`: ein Abo je Browserprofil (`endpoint` UNIQUE), gebunden an die Sitzung, in der
-- es angemeldet wurde. Endet die Sitzung (Abmelden, Ablauf, Beenden, Passwortwechsel, Benutzer
-- gelöscht), fällt das Abo per CASCADE mit; kein Löschweg der Sitzung muss daran denken.
-- `p256dh` und `auth` sind die Schlüssel des Browsers (Base64url) für die Verschlüsselung nach
-- RFC 8291.
CREATE TABLE web_push_abo (
    id                 INTEGER PRIMARY KEY,
    benutzer_id        INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    session_token_hash TEXT    NOT NULL REFERENCES session(token_hash) ON DELETE CASCADE,
    endpoint           TEXT    NOT NULL UNIQUE,
    p256dh             TEXT    NOT NULL,
    auth               TEXT    NOT NULL,
    erstellt_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_web_push_abo_benutzer ON web_push_abo(benutzer_id);
CREATE INDEX idx_web_push_abo_session ON web_push_abo(session_token_hash);
