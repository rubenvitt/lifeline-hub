-- LLH-1490: Instanzkopplung (Change ckq15vzr-instanzkopplung-schluessel, design.md D1, D2, D3,
-- D6, D7). Zwei Lifeline-Hub-Instanzen koppeln sich per Einmal-Code und sprechen nur signiert.

-- Identität dieser Instanz, genau eine Zeile (CHECK id = 1). Erzeugt beim ersten Start; in der
-- DB, damit die Sicherung sie mitnimmt und eine Wiederherstellung jede Kopplung behält. Beide
-- Schlüssel Ed25519 als 32 Byte Base64url ohne Auffüllung.
CREATE TABLE instanz_identitaet (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    kennung     TEXT NOT NULL,
    privat      TEXT NOT NULL,
    oeffentlich TEXT NOT NULL,
    erstellt_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Eine Kopplung je Gegenstelle. `richtung` aus Sicht dieser Instanz: `meldet_sich` (wir haben
-- den Code eingelöst, Adresse des Gegenübers bekannt) oder `wird_gemeldet` (das Gegenüber hat
-- unseren Code eingelöst; wir bauen nie eine Verbindung auf). Zustand nach design.md D6/D9.
CREATE TABLE instanz_kopplung (
    id                       INTEGER PRIMARY KEY,
    gegenueber_kennung       TEXT NOT NULL UNIQUE,
    gegenueber_schluessel    TEXT NOT NULL,
    gegenueber_name          TEXT NOT NULL,
    richtung                 TEXT NOT NULL CHECK (richtung IN ('meldet_sich', 'wird_gemeldet')),
    gegenueber_adresse       TEXT,
    zustand                  TEXT NOT NULL
        CHECK (zustand IN ('angebahnt', 'aktiv', 'widerrufen', 'vom_gegenueber_widerrufen')),
    zuletzt_gesehen_at       TEXT,
    gegenueber_softwarestand TEXT,
    gegenueber_protokoll     INTEGER,
    -- Letzter Fehler beim Melden (nur meldende Seite), leer nach Erfolg.
    letzter_fehler           TEXT,
    -- Hinweis, der bleibt, bis die Kopplung erneuert wird: etwa ein vom Gegenüber gelieferter
    -- Unterschriftsschlüssel, der verworfen wurde.
    hinweis                  TEXT,
    -- Abweichung der Uhr des Gegenübers in Sekunden (Gegenüber minus wir), aus der letzten Antwort.
    uhr_abweichung_s         INTEGER,
    -- Aufeinanderfolgende Fehlschläge beim Melden; trägt die Verdopplung des Abstands.
    fehlversuche             INTEGER NOT NULL DEFAULT 0,
    naechste_meldung_at      TEXT,
    -- Ausstellende Seite: seit wann die Kopplung auf die erste Meldung wartet (D2, 15 Minuten).
    angebahnt_at             TEXT,
    erstellt_at              TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((richtung = 'meldet_sich') = (gegenueber_adresse IS NOT NULL))
);

-- Welche Org dieser Instanz mit welcher Org des Gegenübers gekoppelt ist. Jeder eingelöste Code
-- bindet genau eine Org des Ausstellers an die Org des einlösenden Admins (Spec
-- instanz-kopplung). Die fremde Org über ihre Kennung `<instanzkennung>/<org_id>`; die
-- Übernahme von Kennungen regelt LLH-1493. Widerrufene Zeilen bleiben als Spur.
CREATE TABLE instanz_kopplung_org (
    id                   INTEGER PRIMARY KEY,
    kopplung_id          INTEGER NOT NULL REFERENCES instanz_kopplung(id) ON DELETE CASCADE,
    org_id               INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    fremde_org_kennung   TEXT NOT NULL,
    fremde_org_name      TEXT NOT NULL,
    angelegt_von         INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    angelegt_at          TEXT NOT NULL DEFAULT (datetime('now')),
    widerrufen_at        TEXT,
    -- NULL bei einem Widerruf durch das Gegenüber.
    widerrufen_von       INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    -- Erreichte Seite: wann das Gegenüber den Widerruf signiert erhalten hat.
    widerruf_gemeldet_at TEXT,
    -- Meldende Seite: höchster `stand` der Unterschriftsschlüssel, den wir vom Gegenüber haben.
    unterschrift_stand   INTEGER NOT NULL DEFAULT 0,
    -- Erreichte Seite: wann das Gegenüber diese Zuordnung zum ersten Mal gemeldet hat. Bis dahin
    -- gilt sie als angebahnt und verfällt wie eine angebahnte Kopplung; auf der meldenden Seite
    -- beim Anlegen gesetzt.
    bestaetigt_at        TEXT
);
CREATE UNIQUE INDEX idx_instanz_kopplung_org_aktiv
    ON instanz_kopplung_org (kopplung_id, org_id) WHERE widerrufen_at IS NULL;
CREATE UNIQUE INDEX idx_instanz_kopplung_org_fremd_aktiv
    ON instanz_kopplung_org (kopplung_id, fremde_org_kennung) WHERE widerrufen_at IS NULL;

-- Offene Kopplungscodes (design.md D2). Nie der Code selbst: `suche` ist eine HKDF-Ableitung,
-- `k_einloeser`/`k_aussteller` die Schlüssel der Prüfwerte (Base64url). Mehrere offene Codes je
-- Org sind erlaubt; abgelaufene räumt der Purge-Lauf.
CREATE TABLE instanz_kopplungscode (
    suche           TEXT PRIMARY KEY,
    org_id          INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    k_einloeser     TEXT NOT NULL,
    k_aussteller    TEXT NOT NULL,
    ausgestellt_von INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    ausgestellt_at  TEXT NOT NULL DEFAULT (datetime('now')),
    laeuft_ab_at    TEXT NOT NULL,
    eingeloest_at   TEXT
);

-- Wiederholschutz signierter Anfragen (design.md D3): eine `jti` je Absender genau einmal. In der
-- DB statt im Speicher, damit ein Neustart kein Fenster öffnet (R10). `bis` = Ablauf plus
-- Uhrtoleranz; danach räumt der Purge-Lauf.
CREATE TABLE instanz_jti (
    absender TEXT NOT NULL,
    jti      TEXT NOT NULL,
    bis      TEXT NOT NULL,
    PRIMARY KEY (absender, jti)
);

-- Unterschriftsschlüssel der Org-Admins (design.md D7, Spec org-admin-unterschrift). Getrennt von
-- `webauthn_credential`: der Anmeldeweg liest diese Tabelle nie. `herkunft = lokal`: hier
-- registriert (mit `benutzer_id`); `gegenueber`: von einer gekoppelten Instanz übernommen (mit
-- `kopplung_org_id` und `fremde_id` = id dort). `schluessel` ist der öffentliche Schlüssel in der
-- Form von `alg` (ES256: unkomprimierter SEC1-Punkt, 65 Byte, Base64url). `stand` steigt je Org
-- bei jeder Änderung eines lokalen Schlüssels und trägt die Nachlieferung beim Melden.
CREATE TABLE unterschrift_schluessel (
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
        CHECK (zustand IN ('wartet_auf_gegenzeichnung', 'gueltig', 'widerrufen')),
    -- JSON: Erklärung, Assertion und Fingerabdruck des gegenzeichnenden Schlüssels.
    gegenzeichnung  TEXT,
    stand           INTEGER NOT NULL DEFAULT 0,
    erstellt_at     TEXT NOT NULL DEFAULT (datetime('now')),
    widerrufen_at   TEXT,
    CHECK ((herkunft = 'lokal') = (kopplung_org_id IS NULL)),
    CHECK ((herkunft = 'gegenueber') = (fremde_id IS NOT NULL))
);
CREATE INDEX idx_unterschrift_schluessel_org ON unterschrift_schluessel (org_id, herkunft, stand);
CREATE UNIQUE INDEX idx_unterschrift_schluessel_fremd
    ON unterschrift_schluessel (kopplung_org_id, fremde_id) WHERE herkunft = 'gegenueber';
CREATE UNIQUE INDEX idx_unterschrift_schluessel_credential
    ON unterschrift_schluessel (credential_id) WHERE herkunft = 'lokal';
-- Je Org-Zuordnung ein Schlüssel höchstens einmal, auch widerrufen: ein widerrufener lebt unter
-- neuer id nicht wieder auf.
CREATE UNIQUE INDEX idx_unterschrift_schluessel_fremd_credential
    ON unterschrift_schluessel (kopplung_org_id, credential_id) WHERE herkunft = 'gegenueber';
