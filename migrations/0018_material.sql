-- Material-Stamm (global, org-weit). Katalog von Material-Arten/-Stücken OHNE
-- gezählten Bestand: die Menge entsteht erst bei der Disposition (einsatz_material).
CREATE TABLE material (
    id                  INTEGER PRIMARY KEY,
    org_id              INTEGER NOT NULL REFERENCES organisation(id),
    bezeichnung         TEXT NOT NULL,            -- "Wolldecke", "Stromerzeuger 5 kVA"
    kategorie           TEXT,                     -- Combobox; Vorschläge abgeleitet (DISTINCT)
    bestandsnummer      TEXT,                     -- optional, nur für einzeln verfolgte Geräte (Inventarnr.)
    traegerorganisation TEXT,                     -- frei; UI default = Name der eigenen Org
    standort            TEXT,                     -- Freitext (echter Standort-Stamm später)
    bemerkung           TEXT,
    dienststatus        TEXT NOT NULL DEFAULT 'in_dienst'
                        CHECK (dienststatus IN ('in_dienst', 'ausser_dienst')),
    angelegt_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bestandsnummer je Organisation eindeutig, aber nur unter aktiven Stücken
-- (außer Dienst gestellte geben die Nummer zur Wiederverwendung frei):
CREATE UNIQUE INDEX idx_material_bestandsnummer
    ON material(org_id, bestandsnummer)
    WHERE bestandsnummer IS NOT NULL AND dienststatus = 'in_dienst';
