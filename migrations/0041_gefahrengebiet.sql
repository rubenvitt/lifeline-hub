-- LFH-70: Gefahrenmatrix pro Gefahrengebiet (geografisch).
-- Ein Gefahrengebiet ist die bewertete Fläche; es besteht aus 1..n gezeichneten
-- gefahrengebiet-Zonen (lage_zone) und trägt GENAU EINE 13×5-Matrix.
-- Ablösung der einsatzweiten Matrix (LFH-53) und des Einzelzeigers
-- lage_zone.gefahrentyp/schutzobjekt. Bestand faktisch leer → Drop/Rebuild.

CREATE TABLE gefahrengebiet (
    id           INTEGER PRIMARY KEY,
    einsatz_id   INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    label        TEXT,
    erstellt_von INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at  TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_gefahrengebiet_einsatz ON gefahrengebiet(einsatz_id);

-- gefahr_bewertung neu aufbauen: Zelle hängt am Gefahrengebiet statt am Einsatz.
-- SQLite kann UNIQUE nicht per ALTER ändern → DROP/CREATE (Bestand leer).
DROP TABLE gefahr_bewertung;
CREATE TABLE gefahr_bewertung (
    id                INTEGER PRIMARY KEY,
    gefahrengebiet_id INTEGER NOT NULL REFERENCES gefahrengebiet(id) ON DELETE CASCADE,
    gefahrentyp       TEXT NOT NULL
                        CHECK (gefahrentyp IN ('atemgifte','angstreaktion','ausbreitung',
                          'atomare_strahlung','chemische_stoffe','erkrankung_verletzung',
                          'explosion','elektrizitaet','einsturz','absturz','brand',
                          'durchbruch','ertrinken')),
    schutzobjekt      TEXT NOT NULL
                        CHECK (schutzobjekt IN ('menschen','tiere','umwelt','sachwerte',
                          'einsatzkraefte')),
    warnstufe         TEXT NOT NULL DEFAULT 'keine'
                        CHECK (warnstufe IN ('keine','niedrig','mittel','hoch','akut')),
    beschreibung      TEXT,
    gemeldet_von      TEXT,
    aktualisiert_von  INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at       TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (gefahrengebiet_id, gefahrentyp, schutzobjekt)
);
CREATE INDEX idx_gefahr_bewertung_gebiet ON gefahr_bewertung(gefahrengebiet_id);

-- lage_zone: Einzelzeiger raus, Gruppen-Zugehörigkeit rein.
-- gefahrengebiet_id nur bei typ='gefahrengebiet' gesetzt (App-Invariante), sonst NULL.
ALTER TABLE lage_zone DROP COLUMN gefahrentyp;
ALTER TABLE lage_zone DROP COLUMN schutzobjekt;
ALTER TABLE lage_zone ADD COLUMN gefahrengebiet_id INTEGER
    REFERENCES gefahrengebiet(id) ON DELETE SET NULL;
CREATE INDEX idx_lage_zone_gebiet ON lage_zone(gefahrengebiet_id);
