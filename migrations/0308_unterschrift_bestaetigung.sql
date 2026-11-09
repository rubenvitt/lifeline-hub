-- LLH-1605 (Change zkvt2l8z-unterschrift-bestaetigung, design.md D1): ein vom Gegenüber
-- nachgelieferter neuer Unterschriftsschlüssel wartet an der übernehmenden Seite auf die
-- Bestätigung eines Admins (`wartet_auf_bestaetigung`) oder ist von ihm abgelehnt (`abgelehnt`).
-- Beide Zustände gibt es nur bei Herkunft `gegenueber`. `entschieden_at` und `entschieden_von`
-- halten fest, wer bestätigt oder abgelehnt hat. SQLite ändert keinen CHECK, darum ein Neuaufbau;
-- die Tabelle ist ein Blatt (nichts verweist auf sie) und hat kein AUTOINCREMENT.
CREATE TABLE unterschrift_schluessel_neu (
    id              INTEGER PRIMARY KEY,
    org_id          INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    herkunft        TEXT NOT NULL CHECK (herkunft IN ('lokal', 'gegenueber')),
    kopplung_org_id INTEGER REFERENCES instanz_kopplung_org(id) ON DELETE CASCADE,
    fremde_id       INTEGER,
    benutzer_id     INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    benutzer_name   TEXT NOT NULL,
    credential_id   TEXT NOT NULL,
    alg             TEXT NOT NULL CHECK (alg IN ('es256')),
    schluessel      TEXT NOT NULL,
    rp_id           TEXT NOT NULL,
    origin          TEXT NOT NULL,
    bezeichnung     TEXT NOT NULL,
    fingerabdruck   TEXT NOT NULL,
    zustand         TEXT NOT NULL
        CHECK (zustand IN ('wartet_auf_gegenzeichnung', 'wartet_auf_bestaetigung', 'gueltig',
                           'widerrufen', 'abgelehnt')),
    -- JSON: Erklärung, Assertion und Fingerabdruck des gegenzeichnenden Schlüssels.
    gegenzeichnung  TEXT,
    stand           INTEGER NOT NULL DEFAULT 0,
    erstellt_at     TEXT NOT NULL DEFAULT (datetime('now')),
    widerrufen_at   TEXT,
    -- Bestätigt oder abgelehnt: wann und von wem (nur Herkunft `gegenueber`).
    entschieden_at  TEXT,
    entschieden_von INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    CHECK ((herkunft = 'lokal') = (kopplung_org_id IS NULL)),
    CHECK ((herkunft = 'gegenueber') = (fremde_id IS NOT NULL)),
    CHECK (zustand NOT IN ('wartet_auf_bestaetigung', 'abgelehnt') OR herkunft = 'gegenueber')
);

INSERT INTO unterschrift_schluessel_neu
    (id, org_id, herkunft, kopplung_org_id, fremde_id, benutzer_id, benutzer_name, credential_id,
     alg, schluessel, rp_id, origin, bezeichnung, fingerabdruck, zustand, gegenzeichnung, stand,
     erstellt_at, widerrufen_at)
    SELECT id, org_id, herkunft, kopplung_org_id, fremde_id, benutzer_id, benutzer_name,
           credential_id, alg, schluessel, rp_id, origin, bezeichnung, fingerabdruck, zustand,
           gegenzeichnung, stand, erstellt_at, widerrufen_at
    FROM unterschrift_schluessel;

DROP TABLE unterschrift_schluessel;

ALTER TABLE unterschrift_schluessel_neu RENAME TO unterschrift_schluessel;

-- Die Indizes aus 0300 fallen mit dem DROP; wortgleich neu.
CREATE INDEX idx_unterschrift_schluessel_org ON unterschrift_schluessel (org_id, herkunft, stand);
CREATE UNIQUE INDEX idx_unterschrift_schluessel_fremd
    ON unterschrift_schluessel (kopplung_org_id, fremde_id) WHERE herkunft = 'gegenueber';
CREATE UNIQUE INDEX idx_unterschrift_schluessel_credential
    ON unterschrift_schluessel (credential_id) WHERE herkunft = 'lokal';
-- Je Org-Zuordnung ein Schlüssel höchstens einmal, auch widerrufen oder abgelehnt: er lebt unter
-- neuer id nicht wieder auf.
CREATE UNIQUE INDEX idx_unterschrift_schluessel_fremd_credential
    ON unterschrift_schluessel (kopplung_org_id, credential_id) WHERE herkunft = 'gegenueber';
