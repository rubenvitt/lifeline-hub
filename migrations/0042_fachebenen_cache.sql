-- Persistenter Cache für externe Fachebenen-Daten (NINA/DWD/PEGELONLINE/KRITIS).
-- Überlebt Backend-Neustarts; Schlüssel ist die Quelle bzw. "kritis:<raster-bbox>".
-- antwort_json hält den serialisierten FachebeneAntwort-Umschlag (inkl. GeoJSON).
CREATE TABLE fachebenen_cache (
    schluessel     TEXT PRIMARY KEY,
    gespeichert_at INTEGER NOT NULL,  -- Unix-Sekunden (SQLite unixepoch())
    antwort_json   TEXT NOT NULL
);
