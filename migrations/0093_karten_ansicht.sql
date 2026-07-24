-- LFH-319: karten_ansicht — einsatzweit geteilte, benannte Karten-Konfiguration.
-- Hybrid-Speicher wie einsatz_einstellungen (LFH-55): Skalare als Spalten, Mengen als JSON.
-- Keine CHECK-Constraints — Validierung in Rust, damit die Tabelle per ADD COLUMN
-- erweiterbar bleibt (sqlx-sqlite-Rebuild-Limit, s. LFH-163).
CREATE TABLE karten_ansicht (
    id                  INTEGER PRIMARY KEY,
    einsatz_id          INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    name                TEXT    NOT NULL,
    reihenfolge         INTEGER NOT NULL DEFAULT 0,
    ist_standard        INTEGER NOT NULL DEFAULT 0,
    basemap_modus       TEXT,           -- 'online' | 'offline' | 'blind'
    online_stil         TEXT,           -- Name aus KarteServerConfig.online_styles
    karten_theme        TEXT,           -- 'auto' | 'light' | 'dark'
    layer_sichtbar      TEXT,           -- JSON, Schlüssel = LayerSichtbar (FE)
    fachebenen_sichtbar TEXT,           -- JSON {"nina","dwd","pegelonline","kritis"}
    zentrum_lat         REAL,
    zentrum_lon         REAL,
    zoom                REAL,
    erstellt_von        INTEGER REFERENCES benutzer(id),
    erstellt_at         TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at        TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_von       INTEGER REFERENCES benutzer(id)
);
CREATE INDEX idx_karten_ansicht_einsatz ON karten_ansicht(einsatz_id);
-- Genau eine Standardansicht je Einsatz auf DB-Ebene (additiv, kein Rebuild). Das
-- Umsetzen des Standards läuft in EINER Transaktion (alt auf 0, neu auf 1) — s. repo.
CREATE UNIQUE INDEX idx_karten_ansicht_standard
    ON karten_ansicht(einsatz_id) WHERE ist_standard = 1;
