-- L‑3 Gefahren-/Absperrzonen: freier, entitätsloser Annotations-Layer.
-- Eigenständige einsatz-skopierte Entität (Vorbild einsatzabschnitt/0014).
-- Zwei unabhängige CHECKs (typ, geometrie_typ); die fachliche Bindung
-- (welcher typ welche Geometrie haben darf) erzwingt die App, nicht die DB.
-- farbe nur für freie_skizze gesetzt; sonst NULL (Stil sonst aus typ abgeleitet).
-- Hard-Delete: die Historie lebt im ETB; ON DELETE CASCADE räumt beim Einsatz-Löschen auf.
CREATE TABLE lage_zone (
    id            INTEGER PRIMARY KEY,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    typ           TEXT NOT NULL
                    CHECK (typ IN ('gefahrengebiet','absperrbereich','absperrgrenze','sperrgebiet','freie_skizze')),
    geometrie_typ TEXT NOT NULL
                    CHECK (geometrie_typ IN ('Polygon','LineString')),
    geometrie     TEXT NOT NULL,   -- GeoJSON-Geometry (Polygon oder LineString)
    label         TEXT,
    farbe         TEXT,            -- nur freie_skizze; sonst NULL
    notiz         TEXT,
    erstellt_von  INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at   TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lage_zone_einsatz ON lage_zone(einsatz_id);
