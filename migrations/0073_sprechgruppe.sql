-- LFH-109: Sprechgruppen-Katalog (Stammdaten) + einsatz-lokale Sprechgruppen.
-- Scope über einsatz_id: NULL = org-weiter Katalog, gesetzt = einsatz-lokal.
-- M:N-Zuordnung an Einsatzabschnitt und Einsatz-Einheit. Migriert die LFH-86-
-- Freitextwerte (einsatzabschnitt.sprechgruppe_tmo/_dmo, aus 0047) ins Join-Modell;
-- die Alt-Spalten bleiben als read-only Reserve unangetastet.
CREATE TABLE sprechgruppe (
    id          INTEGER PRIMARY KEY,
    org_id      INTEGER NOT NULL REFERENCES organisation(id),
    einsatz_id  INTEGER REFERENCES einsatz(id) ON DELETE CASCADE,
    bezeichnung TEXT NOT NULL,
    betriebsart TEXT NOT NULL CHECK (betriebsart IN ('TMO','DMO')),
    hinweis     TEXT,
    aktiv       INTEGER NOT NULL DEFAULT 1,
    sortier     INTEGER NOT NULL DEFAULT 0,
    angelegt_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_sprechgruppe_katalog
    ON sprechgruppe(org_id, betriebsart, bezeichnung)
    WHERE einsatz_id IS NULL AND aktiv = 1;
CREATE UNIQUE INDEX idx_sprechgruppe_einsatz_lokal
    ON sprechgruppe(einsatz_id, betriebsart, bezeichnung)
    WHERE einsatz_id IS NOT NULL;
CREATE INDEX idx_sprechgruppe_org     ON sprechgruppe(org_id);
CREATE INDEX idx_sprechgruppe_einsatz ON sprechgruppe(einsatz_id);

CREATE TABLE einsatzabschnitt_sprechgruppe (
    abschnitt_id    INTEGER NOT NULL REFERENCES einsatzabschnitt(id) ON DELETE CASCADE,
    sprechgruppe_id INTEGER NOT NULL REFERENCES sprechgruppe(id)     ON DELETE CASCADE,
    PRIMARY KEY (abschnitt_id, sprechgruppe_id)
);
CREATE TABLE einsatz_einheit_sprechgruppe (
    einheit_id      INTEGER NOT NULL REFERENCES einsatz_einheit(id) ON DELETE CASCADE,
    sprechgruppe_id INTEGER NOT NULL REFERENCES sprechgruppe(id)    ON DELETE CASCADE,
    PRIMARY KEY (einheit_id, sprechgruppe_id)
);

-- Daten-Migration LFH-86 → einsatz-lokal + Join (TMO).
INSERT OR IGNORE INTO sprechgruppe (org_id, einsatz_id, bezeichnung, betriebsart)
SELECT DISTINCT e.org_id, ea.einsatz_id, trim(ea.sprechgruppe_tmo), 'TMO'
FROM einsatzabschnitt ea JOIN einsatz e ON e.id = ea.einsatz_id
WHERE ea.sprechgruppe_tmo IS NOT NULL AND trim(ea.sprechgruppe_tmo) <> '';
INSERT OR IGNORE INTO einsatzabschnitt_sprechgruppe (abschnitt_id, sprechgruppe_id)
SELECT ea.id, sg.id FROM einsatzabschnitt ea
JOIN sprechgruppe sg ON sg.einsatz_id = ea.einsatz_id AND sg.betriebsart = 'TMO'
                    AND sg.bezeichnung = trim(ea.sprechgruppe_tmo)
WHERE ea.sprechgruppe_tmo IS NOT NULL AND trim(ea.sprechgruppe_tmo) <> '';

-- Daten-Migration LFH-86 → einsatz-lokal + Join (DMO).
INSERT OR IGNORE INTO sprechgruppe (org_id, einsatz_id, bezeichnung, betriebsart)
SELECT DISTINCT e.org_id, ea.einsatz_id, trim(ea.sprechgruppe_dmo), 'DMO'
FROM einsatzabschnitt ea JOIN einsatz e ON e.id = ea.einsatz_id
WHERE ea.sprechgruppe_dmo IS NOT NULL AND trim(ea.sprechgruppe_dmo) <> '';
INSERT OR IGNORE INTO einsatzabschnitt_sprechgruppe (abschnitt_id, sprechgruppe_id)
SELECT ea.id, sg.id FROM einsatzabschnitt ea
JOIN sprechgruppe sg ON sg.einsatz_id = ea.einsatz_id AND sg.betriebsart = 'DMO'
                    AND sg.bezeichnung = trim(ea.sprechgruppe_dmo)
WHERE ea.sprechgruppe_dmo IS NOT NULL AND trim(ea.sprechgruppe_dmo) <> '';
