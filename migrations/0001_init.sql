-- Schlüssel/Wert-Tabelle für Schema-/App-Metadaten.
CREATE TABLE app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO app_meta (key, value) VALUES ('schema_initialized', '1');
