-- no-transaction
-- LLH-2094: Ausgang per Matrix (Spec docs/superpowers/specs/2026-11-25-ntaizave-ausgang-matrix-design.md,
-- Abschnitt 6, „Neue AusgangFehler-Codes“). Der CHECK von `ausgang.fehler_art` kennt zusätzlich
-- `kein_zutritt` (kein Zutritt zum Matrix-Raum) und `verschluesselung` (Verschlüsseln nicht
-- möglich); die Liste ist `AusgangFehler::ALLE` (Test
-- `ausgang::tests::check_listen_entsprechen_den_enums`). Sonst ist die Tabelle wie in 0383.
--
-- SQLite ändert einen Tabellen-CHECK nur per Rebuild, und `ausgang` ist kein Blatt:
--   ausgang_teil.versand_id  (NOT NULL, ON DELETE CASCADE, 0386)
-- Deshalb `-- no-transaction` und PRAGMA foreign_keys = OFF (migrations/AGENTS.md, „Tabellenumbau
-- und `-- no-transaction`“); `db::migrate` rahmt den Umbau in eine Transaktion. Die ids bleiben,
-- die Zeilen von `ausgang_teil` hängen danach wieder an derselben Tabelle.

PRAGMA foreign_keys = OFF;

CREATE TABLE ausgang_neu (
    id                    TEXT PRIMARY KEY,
    org_id                INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    einsatz_id            INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    client_id             TEXT NOT NULL,
    quelle_art            TEXT NOT NULL CHECK (quelle_art IN ('lagebericht', 'befehl', 'nachforderung')),
    quelle_id             INTEGER NOT NULL,
    kanal                 TEXT NOT NULL CHECK (kanal IN ('email', 'fax', 'matrix', 'threema')),
    externe_stelle_id     INTEGER REFERENCES org_externe_stelle(id) ON DELETE SET NULL,
    stelle_bezeichnung    TEXT NOT NULL,
    adresse               TEXT NOT NULL,
    betreff               TEXT NOT NULL,
    inhalt                TEXT NOT NULL,
    zustand               TEXT NOT NULL DEFAULT 'wartet'
        CHECK (zustand IN ('wartet', 'uebergeben', 'fehlgeschlagen')),
    versuche              INTEGER NOT NULL DEFAULT 0,
    naechster_versuch_at  TEXT,
    erster_versuch_at     TEXT,
    versuch_begonnen_at   TEXT,
    fehler_art            TEXT CHECK (fehler_art IS NULL OR fehler_art IN (
        'voruebergehend', 'abgelehnt', 'ungewiss', 'ueberholt', 'anbindung_fehlt',
        'anbindung_angehalten', 'anbindung_fehler', 'zu_gross', 'spiegel', 'kein_zutritt',
        'verschluesselung')),
    fehler_status         INTEGER,
    erstellt_von_id       INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at           TEXT NOT NULL,
    uebergeben_at         TEXT,
    etb_eintrag_id        INTEGER REFERENCES etb_eintrag(id) ON DELETE SET NULL,
    UNIQUE (org_id, client_id)
);

INSERT INTO ausgang_neu
    (id, org_id, einsatz_id, client_id, quelle_art, quelle_id, kanal, externe_stelle_id,
     stelle_bezeichnung, adresse, betreff, inhalt, zustand, versuche, naechster_versuch_at,
     erster_versuch_at, versuch_begonnen_at, fehler_art, fehler_status, erstellt_von_id,
     erstellt_at, uebergeben_at, etb_eintrag_id)
    SELECT id, org_id, einsatz_id, client_id, quelle_art, quelle_id, kanal, externe_stelle_id,
           stelle_bezeichnung, adresse, betreff, inhalt, zustand, versuche, naechster_versuch_at,
           erster_versuch_at, versuch_begonnen_at, fehler_art, fehler_status, erstellt_von_id,
           erstellt_at, uebergeben_at, etb_eintrag_id
    FROM ausgang;

DROP TABLE ausgang;

ALTER TABLE ausgang_neu RENAME TO ausgang;

CREATE INDEX idx_ausgang_faellig ON ausgang(zustand, naechster_versuch_at);
CREATE INDEX idx_ausgang_quelle ON ausgang(einsatz_id, quelle_art, quelle_id);

PRAGMA foreign_keys = ON;
