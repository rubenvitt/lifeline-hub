-- LLH-1652 (Change quf3qdil-maschinenzugang, design.md D2): Maschinenzugang für Fremdsysteme an
-- der öffentlichen API `/api/v1/` (ADR-0022). Eigene Tabellen, damit ein Widerruf keine
-- Instanzkopplung berührt.

-- Ein Zugang je Fremdsystem. `id` ist die UUID, zugleich `kid` und `iss` seiner Anfragen.
CREATE TABLE maschinenzugang (
    id                            TEXT    PRIMARY KEY,
    org_id                        INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    name                          TEXT    NOT NULL,
    -- JSON-Liste der Wire-Werte von `public_api::Scope`, sortiert und ohne Dopplung.
    scopes                        TEXT    NOT NULL,
    gueltig_bis                   TEXT,
    zustand                       TEXT    NOT NULL DEFAULT 'wartet'
                                          CHECK (zustand IN ('wartet', 'aktiv', 'widerrufen')),
    -- Öffentlicher Ed25519-Schlüssel (Base64url der 32 Bytes); `schluessel_neu` während eines
    -- Wechsels, bis er zum ersten Mal signiert (design.md D7).
    schluessel                    TEXT,
    schluessel_neu                TEXT,
    angelegt_at                   TEXT    NOT NULL DEFAULT (datetime('now')),
    angelegt_von                  INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    -- Letzte Änderung durch einen Admin (Ändern, Widerruf); Basis des optimistischen Locks
    -- (`basis_geaendert_at`), ohne Änderung gilt `angelegt_at`.
    geaendert_at                  TEXT,
    widerrufen_at                 TEXT,
    widerrufen_von                INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    -- höchstens minütlich fortgeschrieben
    zuletzt_genutzt_at            TEXT,
    -- Letzte Ablehnung eines bekannten Zugangs (Wire-Wert von `public_api::AblehnungGrund`),
    -- höchstens alle 60 s neu geschrieben, außer der Grund wechselt (design.md D6).
    letzte_ablehnung_at           TEXT,
    letzte_ablehnung_grund        TEXT,
    letzte_ablehnung_abweichung_s INTEGER
);
CREATE INDEX idx_maschinenzugang_org ON maschinenzugang (org_id);

-- Einmal-Codes. Gespeichert sind nur die Ableitungen (`instanz::code::derive_mit_salz` mit
-- `SALZ_MACHINE`); `suche` geht über die Leitung und findet die Zeile.
CREATE TABLE maschinenzugang_code (
    suche           TEXT    PRIMARY KEY,
    zugang_id       TEXT    NOT NULL REFERENCES maschinenzugang(id) ON DELETE CASCADE,
    k_einloeser     TEXT    NOT NULL,
    k_aussteller    TEXT    NOT NULL,
    laeuft_ab_at    TEXT    NOT NULL,
    eingeloest_at   TEXT,
    ausgestellt_von INTEGER REFERENCES benutzer(id) ON DELETE SET NULL
);
CREATE INDEX idx_maschinenzugang_code_zugang ON maschinenzugang_code (zugang_id);

-- Wiederholschutz: jede `jti` eines Zugangs genau einmal, bis `bis` (Ablauf plus Uhrtoleranz).
CREATE TABLE maschine_jti (
    zugang_id TEXT NOT NULL,
    jti       TEXT NOT NULL,
    bis       TEXT NOT NULL,
    PRIMARY KEY (zugang_id, jti)
);
CREATE INDEX idx_maschine_jti_bis ON maschine_jti (bis);

-- Abrufprotokoll je Zugang, Route (Vorlage, nie der konkrete Pfad) und Tag (UTC), 365 Tage.
CREATE TABLE maschine_abruf (
    zugang_id  TEXT    NOT NULL REFERENCES maschinenzugang(id) ON DELETE CASCADE,
    route      TEXT    NOT NULL,
    tag        TEXT    NOT NULL,
    anzahl     INTEGER NOT NULL DEFAULT 0,
    erster_at  TEXT    NOT NULL,
    letzter_at TEXT    NOT NULL,
    PRIMARY KEY (zugang_id, route, tag)
);
CREATE INDEX idx_maschine_abruf_tag ON maschine_abruf (tag);
