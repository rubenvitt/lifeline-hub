-- LFH-179: Karten-Registry — Kartenkonfig von ENV-only auf DB-gestützt/laufzeit-schreibbar.
-- Zwei getrennte Tabellen (Online-Quellen vs. Offline-Karten), weil sich die Spalten kaum
-- überschneiden und die Offline-Seite für LFH-181 (Download-Manager) reiche Lebenszyklus-Felder
-- braucht, ohne die Online-Zeilen zu verschmutzen.
--
-- GLOBAL, KEIN org_id: /api/karte/config und /api/karte/tiles.pmtiles sind unauthentifiziert
-- (kein Auth-Extractor, kein globaler Auth-Layer) — ohne Org-Kontext im Request ist Org-Scoping
-- nicht durchführbar, ohne den öffentlichen Endpoint-Vertrag zu brechen. Die Kartenkonfig ist
-- ohnehin Server-/Deployment-weit (eine Datei, eine Liste, die der Server ausliefert), nicht
-- Org-Daten. Falls je Multi-Tenant: nullable org_id (NULL=global) additiv nachrüstbar.
--
-- Rein additiv (nur CREATE) — kein CHECK-Rebuild, no-transaction-Caveat irrelevant.
-- KEIN Daten-Seed: die Registry startet leer; Quellen kommen über die Admin-UI / den
-- Vorschlagskatalog (config::default_online_styles). ENV-Kartenkonfig entfällt ganz (LFH-179).

-- Online-Basemap-Quellen (Vektor-Style-JSON oder Raster-Tile-Template).
-- aktiv = enabled/in-der-Liste (Soft-Delete-Flag; mehrere Zeilen dürfen aktiv sein).
CREATE TABLE karte_online_quelle (
    id           INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL,
    url          TEXT    NOT NULL,
    typ          TEXT    NOT NULL DEFAULT 'vektor' CHECK (typ IN ('vektor', 'raster')),
    attribution  TEXT,
    sortier      INTEGER NOT NULL DEFAULT 0,
    aktiv        INTEGER NOT NULL DEFAULT 1 CHECK (aktiv IN (0, 1)),
    erstellt_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    geaendert_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Offline-Karten (PMTiles). v1 nutzt der Grundstein name/pfad/status/aktiv_basemap; die
-- übrigen Felder (quell_url/lizenz/groesse/sha256/download_at) trägt LFH-181 (Download-Manager).
-- pfad: absolut (extern registriert) ODER relativ zu karten_dir (LFH-181-Downloads, portabel).
-- kachel_schema bewusst OHNE CHECK — abweichende Schemata (MBTiles, basemap.de) später ohne
-- CHECK-Rebuild ergänzbar. aktiv_basemap = die EINE von /tiles ausgelieferte Karte.
CREATE TABLE karte_offline_karte (
    id            INTEGER PRIMARY KEY,
    name          TEXT    NOT NULL,
    pfad          TEXT    NOT NULL,
    quell_url     TEXT,
    lizenz        TEXT,
    kachel_schema TEXT    NOT NULL DEFAULT 'protomaps',
    groesse       INTEGER,
    sha256        TEXT,
    download_at   TEXT,
    status        TEXT    NOT NULL DEFAULT 'bereit'
                  CHECK (status IN ('registriert', 'laedt', 'bereit', 'fehler')),
    aktiv_basemap INTEGER NOT NULL DEFAULT 0 CHECK (aktiv_basemap IN (0, 1)),
    sortier       INTEGER NOT NULL DEFAULT 0,
    erstellt_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    geaendert_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Höchstens eine aktive Offline-Karte (v1: genau eine ausgelieferte Basemap).
CREATE UNIQUE INDEX idx_offline_eine_aktive
    ON karte_offline_karte (aktiv_basemap) WHERE aktiv_basemap = 1;
