-- LFH-170: Freie taktische Zeichen — entitätsloser Punkt-Marker-Layer.
-- Eigenständige einsatz-skopierte Entität (Vorbild lage_zone/0036), ABER ohne
-- Gruppen-/Gefahrengebiet-Logik: ein freies Zeichen ist ein einzelner Punkt (lat/lon)
-- mit taktischen Overlays (Grundzeichen + optionale Fachaufgabe/Einheit/Funktion/…).
-- Keine CHECK-Constraints auf die TZ-Spalten (voller DV-102-Katalog, Validierung leicht
-- in der App). Hard-Delete: ON DELETE CASCADE räumt beim Einsatz-Löschen auf.
CREATE TABLE freies_zeichen (
    id            INTEGER PRIMARY KEY,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    lat           REAL NOT NULL,
    lon           REAL NOT NULL,
    grundzeichen  TEXT NOT NULL,
    organisation  TEXT,
    fachaufgabe   TEXT,
    symbol        TEXT,
    einheit       TEXT,
    funktion      TEXT,
    farbe         TEXT,
    label         TEXT,
    erstellt_von  INTEGER REFERENCES benutzer(id),
    erstellt_at   TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_freies_zeichen_einsatz ON freies_zeichen(einsatz_id);
