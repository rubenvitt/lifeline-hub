-- Gefahrenmatrix-Bewertung (LFH-53): pro Einsatz max. 1 Bewertung je (gefahrentyp,
-- schutzobjekt). Warnstufe ist die Wahrheit; gefahrengebiet-Zonen referenzieren diese
-- Zelle app-seitig (kein DB-FK, Hauskonvention wie lage_zone).
-- CHECKs je Spalte einzeln; die Kombinations-Gültigkeit (ungültige typ×objekt-Paare)
-- erzwingt die App, nicht die DB. liste() blendet warnstufe='keine' aus (kein Phantom).
-- Hard-Delete via ON DELETE CASCADE beim Einsatz-Löschen; Historie lebt im ETB.
CREATE TABLE gefahr_bewertung (
    id               INTEGER PRIMARY KEY,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    gefahrentyp      TEXT NOT NULL
                       CHECK (gefahrentyp IN ('atemgifte','angstreaktion','ausbreitung',
                         'atomare_strahlung','chemische_stoffe','erkrankung_verletzung',
                         'explosion','elektrizitaet','einsturz','absturz','brand',
                         'durchbruch','ertrinken')),
    schutzobjekt     TEXT NOT NULL
                       CHECK (schutzobjekt IN ('menschen','tiere','umwelt','sachwerte',
                         'einsatzkraefte')),
    warnstufe        TEXT NOT NULL DEFAULT 'keine'
                       CHECK (warnstufe IN ('keine','niedrig','mittel','hoch','akut')),
    beschreibung     TEXT,
    gemeldet_von     TEXT,
    aktualisiert_von INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at      TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at     TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (einsatz_id, gefahrentyp, schutzobjekt)
);
CREATE INDEX idx_gefahr_bewertung_einsatz ON gefahr_bewertung(einsatz_id);
