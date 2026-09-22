-- LFH-635: Ablösung von Einheiten. Eine Zeile = eine Schicht einer Einheit im Einsatz:
-- Einsatzbeginn + Rhythmus → Fälligkeit, geplante ablösende Einheit, Vollzug. Je Einheit
-- läuft höchstens eine Schicht. Die Einstufung (planmäßig/Vorwarnung/überfällig) wird beim
-- Lesen gegen die aktuelle Zeit berechnet und nicht gespeichert.
CREATE TABLE einsatz_abloesung (
    id                    INTEGER PRIMARY KEY,
    einsatz_id            INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    einheit_id            INTEGER NOT NULL REFERENCES einsatz_einheit(id) ON DELETE CASCADE,
    -- Einsatzstelle der Schicht als Snapshot (nicht über die Einheit gejoint): eine
    -- Folgeschicht erbt ihn, auch wenn die ablösende Einheit noch anderswo geführt wird.
    abschnitt_id          INTEGER REFERENCES einsatzabschnitt(id) ON DELETE SET NULL,
    beginn_at             TEXT    NOT NULL,
    rhythmus_minuten      INTEGER NOT NULL CHECK (rhythmus_minuten > 0 AND rhythmus_minuten <= 10080),
    -- abschnitt = folgt der Vorgabe des Abschnitts; einheit = eigener Wert
    rhythmus_quelle       TEXT    NOT NULL CHECK (rhythmus_quelle IN ('abschnitt','einheit')),
    -- Gespeichert = beginn_at + rhythmus_minuten; wird nur zusammen mit beiden geschrieben.
    faellig_at            TEXT    NOT NULL,
    abloesende_einheit_id INTEGER REFERENCES einsatz_einheit(id) ON DELETE SET NULL,
    status                TEXT    NOT NULL DEFAULT 'laufend' CHECK (status IN ('laufend','abgeloest')),
    vollzogen_at          TEXT,
    vollzogen_von_id      INTEGER REFERENCES benutzer(id),
    -- Folgeschicht → abgelöste Schicht (Rückweg der Rücknahme)
    vorgaenger_id         INTEGER REFERENCES einsatz_abloesung(id) ON DELETE SET NULL,
    -- ETB-Eintrag des Vollzugs; Bezug der Berichtigung bei Rücknahme
    etb_vollzug_id        INTEGER REFERENCES etb_eintrag(id),
    angelegt_von_id       INTEGER NOT NULL REFERENCES benutzer(id),
    angelegt_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_abloesung_laufend_je_einheit
    ON einsatz_abloesung(einheit_id) WHERE status = 'laufend';
CREATE INDEX idx_abloesung_einsatz ON einsatz_abloesung(einsatz_id, status, faellig_at);

-- Rhythmus-Vorgabe je Einsatzabschnitt in Minuten; NULL = keine Vorgabe.
ALTER TABLE einsatzabschnitt ADD COLUMN abloesung_rhythmus_minuten INTEGER
    CHECK (abloesung_rhythmus_minuten IS NULL OR (abloesung_rhythmus_minuten > 0 AND abloesung_rhythmus_minuten <= 10080));
