-- Reverse-Geocoding-Cache (Ort-Vorschau). Schlüssel = auf ~100 m gerundete Koordinate
-- als INTEGER (lat*1000, lon*1000), exakte Gleichheit als PK. Ergebnis ist faktisch
-- unveränderlich → quasi-permanente TTL (kein Prune nötig; Tabelle bleibt klein, weil
-- Nachbarpunkte denselben Eintrag teilen). Andere Form als fachebenen_cache (das eine
-- periodisch erneuerte FeatureCollection hält) — wiederverwendet wird das reqwest-Proxy-
-- Konzept, nicht die Tabelle.
CREATE TABLE geocoding_cache (
    lat_key     INTEGER NOT NULL,
    lon_key     INTEGER NOT NULL,
    ortsname    TEXT    NOT NULL,
    erstellt_at TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (lat_key, lon_key)
);

-- Konfigurierbare Geocoder-Basis-URL je Organisation; NULL = öffentlicher Nominatim.
ALTER TABLE org_einstellungen ADD COLUMN geocoder_url TEXT;
