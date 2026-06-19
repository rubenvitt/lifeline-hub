-- Einsatz-Einstellungen (LFH-55 / LFH-131) — 1:1-Leaf-Tabelle pro Einsatz.
-- Hybrid-Speichermodell (Decision Record LFH-55): skalare Spalten + JSON für
-- Mengen. KEINE CHECK-Constraints (Validierung in Rust) — die Leaf-Tabelle bleibt
-- so trotz des sqlx-sqlite-0.8.6-Rebuild-Limits wartbar, und spätere Felder
-- (z. B. Anzeige-Konventionen) lassen sich per ADD COLUMN ohne Rebuild nachrüsten.
CREATE TABLE einsatz_einstellungen (
    einsatz_id          INTEGER PRIMARY KEY REFERENCES einsatz(id) ON DELETE CASCADE,
    -- Kat. 1: Landing-Override; Modul-Key (Registry-validiert im Frontend). NULL = redirectZiel().
    standard_modul      TEXT,
    -- Karten-Defaults: NULL = Verfügbarkeits-/Karten-Default.
    basemap_modus       TEXT,           -- 'online' | 'offline' | 'blind'
    karten_zoom_start   REAL,           -- 0..=28
    fachebenen_sichtbar TEXT,           -- JSON {"nina":bool,"dwd":bool,"pegelonline":bool,"kritis":bool}
    geaendert_at        TEXT,
    geaendert_von       INTEGER REFERENCES benutzer(id)
);
