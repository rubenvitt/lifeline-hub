-- LFH-48: strukturierte Lageberichte. Einsatz-skopiertes Entity (Vorbild
-- einsatzabschnitt/0014); editierbarer Arbeits-/Versionsstand. Bei Freigabe
-- wird der gerenderte Volltext unveränderlich in einen etb_eintrag (typ='lage')
-- gesnapshottet — der ETB bleibt der manipulationssichere Rechtsstand.
CREATE TABLE lagebericht (
    id                 INTEGER PRIMARY KEY,
    einsatz_id         INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    vorlage            TEXT NOT NULL
                       CHECK (vorlage IN ('lagebericht','lagebeurteilung','freitext')),
    titel              TEXT NOT NULL,
    zeitstand          TEXT NOT NULL,            -- beschriebener Lage-Zeitpunkt (SQLite-Format)
    status             TEXT NOT NULL DEFAULT 'entwurf'
                       CHECK (status IN ('entwurf','freigegeben')),
    -- Gefüllte Abschnitte als JSON-Array [{schluessel, text}], Reihenfolge = Vorlage.
    abschnitte         TEXT NOT NULL,
    version            INTEGER NOT NULL DEFAULT 1,
    vorgaenger_id      INTEGER REFERENCES lagebericht(id),  -- Fortschreibungs-Kette
    ersteller_id       INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at        TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_at    TEXT NOT NULL DEFAULT (datetime('now')),
    freigegeben_von_id INTEGER REFERENCES benutzer(id),
    freigegeben_at     TEXT,
    etb_eintrag_id     INTEGER REFERENCES etb_eintrag(id)   -- gesetzt bei Freigabe
);

CREATE INDEX idx_lagebericht_einsatz ON lagebericht(einsatz_id, status, zeitstand);

-- Additive Rückverlinkung in der ETB-Timeline (Badge "Lagebericht"). Nullable
-- ADD COLUMN ist sicher und berührt die FTS-Trigger (inhalt/von/an/veranlassung) nicht.
ALTER TABLE etb_eintrag ADD COLUMN lagebericht_id INTEGER REFERENCES lagebericht(id);
