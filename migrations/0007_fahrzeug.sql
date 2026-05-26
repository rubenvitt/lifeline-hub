-- Globaler, org-weiter Fahrzeug-Stamm (Fuhrpark der Organisation).
-- Kein Hard-Delete: "löschen" = dienststatus auf 'ausser_dienst' setzen, damit
-- Referenzen aus (auch abgeschlossenen) Einsätzen immer auflösbar bleiben.
CREATE TABLE fahrzeug (
    id                   INTEGER PRIMARY KEY,
    org_id               INTEGER NOT NULL REFERENCES organisation(id),
    funkrufname          TEXT NOT NULL,
    fahrzeugtyp          TEXT,                       -- Combobox; Vorschläge abgeleitet (DISTINCT)
    traegerorganisation  TEXT,                       -- frei; UI-Default = Name der eigenen Org
    kennzeichen          TEXT,
    opta                 TEXT,
    standort             TEXT,                       -- Freitext (echter Standort-Stamm später)
    fms_issi             TEXT,                       -- Digitalfunk-Kennung (Zukunfts-Haken)
    sondersignal         INTEGER NOT NULL DEFAULT 0, -- 0/1: Sonder-/Wegerecht
    tragenkapazitaet     INTEGER,                    -- optional, San-Typen
    staerke_fuehrer      INTEGER,                    -- Sollbesatzung (taktische Stärke), optional
    staerke_unterfuehrer INTEGER,
    staerke_mannschaft   INTEGER,
    bemerkung            TEXT,
    dienststatus         TEXT NOT NULL DEFAULT 'in_dienst'
                         CHECK (dienststatus IN ('in_dienst', 'ausser_dienst')),
    angelegt_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Funkrufname je Organisation eindeutig, aber nur unter aktiven Fahrzeugen:
-- außer Dienst gestellte geben ihren Namen zur Wiederverwendung frei.
CREATE UNIQUE INDEX idx_fahrzeug_funkrufname
    ON fahrzeug(org_id, funkrufname) WHERE dienststatus = 'in_dienst';
