-- Globaler, org-weiter Personenstamm (Einsatzkräfte der Organisation).
-- Kein Hard-Delete: "löschen" = dienststatus auf 'ausser_dienst' (Referenzen aus
-- Dispositionen bleiben auflösbar). benutzer_id ist ein optionaler Link auf ein
-- App-Konto (Mehrheit der Kräfte hat kein Login).
CREATE TABLE personal (
    id                  INTEGER PRIMARY KEY,
    org_id              INTEGER NOT NULL REFERENCES organisation(id),
    benutzer_id         INTEGER REFERENCES benutzer(id),  -- optionaler Link zum App-Konto
    name                TEXT NOT NULL,                    -- Klarname/Anzeigename (NICHT eindeutig)
    personalnummer      TEXT,                             -- optional, org-intern
    traegerorganisation TEXT,                             -- frei; UI-Default = Name der eigenen Org
    telefon             TEXT,                             -- optional, minimale Kontakt-PII
    staerke_position    TEXT                              -- Stamm-Default-Position, optional
                        CHECK (staerke_position IN ('fuehrer', 'unterfuehrer', 'mannschaft')),
    bemerkung           TEXT,
    dienststatus        TEXT NOT NULL DEFAULT 'in_dienst'
                        CHECK (dienststatus IN ('in_dienst', 'ausser_dienst')),
    angelegt_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Personalnummer je Organisation eindeutig, aber nur unter aktiven Personen
-- (außer Dienst gestellte geben die Nummer zur Wiederverwendung frei):
CREATE UNIQUE INDEX idx_personal_personalnummer
    ON personal(org_id, personalnummer)
    WHERE personalnummer IS NOT NULL AND dienststatus = 'in_dienst';

-- Höchstens ein Personal-Datensatz je verknüpftem Benutzerkonto:
CREATE UNIQUE INDEX idx_personal_benutzer
    ON personal(benutzer_id) WHERE benutzer_id IS NOT NULL;
