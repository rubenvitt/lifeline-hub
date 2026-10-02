-- LFH-751: Schwärzungsantrag (Löschersuchen nach Art. 17 DSGVO) für einen ganzen Einsatz oder
-- genau eine Person. Eine Zeile = ein Ersuchen mit eigenem Lebenszyklus: offen → zurückgenommen
-- (innerhalb von 24 h) oder vollzogen (Purge-Lauf ab faellig_at). Die Zeile bleibt nach Rücknahme
-- und Vollzug stehen: sie ist der Nachweis, dass die Organisation dem Ersuchen nachgekommen ist.
-- Herleitung: openspec/changes/lfh-751-sofort-schwaerzung-auf-antrag/design.md, D1.
--
-- ziel_id ist polymorph (je nach ziel_art einsatz_person, einsatz_personal, infotelefon_anruf
-- oder medienkontakt) und deshalb ohne Fremdschlüssel; bei ziel_art = 'einsatz' ist es NULL.
-- faellig_at = beantragt_at + 24 h wird gespeichert, damit Rücknahme und Vollzug die Grenze im
-- bewachten UPDATE vergleichen, ohne Datumsrechnung in SQL.
CREATE TABLE schwaerzung_antrag (
    id                  INTEGER PRIMARY KEY,
    einsatz_id          INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    ziel_art            TEXT    NOT NULL
                        CHECK (ziel_art IN ('einsatz', 'betroffene', 'externe_kraft',
                                            'infotelefon_anruf', 'medienkontakt')),
    ziel_id             INTEGER,
    aktenzeichen        TEXT    NOT NULL CHECK (length(trim(aktenzeichen)) BETWEEN 1 AND 64),
    beantragt_von       INTEGER NOT NULL REFERENCES benutzer(id),
    beantragt_at        TEXT    NOT NULL,
    faellig_at          TEXT    NOT NULL,
    zurueckgenommen_at  TEXT,
    zurueckgenommen_von INTEGER REFERENCES benutzer(id),
    vollzogen_at        TEXT,
    CHECK ((ziel_art = 'einsatz') = (ziel_id IS NULL)),
    CHECK ((zurueckgenommen_at IS NULL) = (zurueckgenommen_von IS NULL)),
    CHECK (zurueckgenommen_at IS NULL OR vollzogen_at IS NULL)
);
-- Höchstens ein offener Antrag je Ziel. SQLite behandelt NULL im UNIQUE als verschieden,
-- deshalb COALESCE für den Einsatz-Antrag (ziel_id NULL).
CREATE UNIQUE INDEX idx_schwaerzung_antrag_offen
    ON schwaerzung_antrag(einsatz_id, ziel_art, COALESCE(ziel_id, 0))
    WHERE zurueckgenommen_at IS NULL AND vollzogen_at IS NULL;
CREATE INDEX idx_schwaerzung_antrag_faellig
    ON schwaerzung_antrag(faellig_at)
    WHERE zurueckgenommen_at IS NULL AND vollzogen_at IS NULL;
