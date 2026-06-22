-- LFH-64: strukturierte Befehlsgebung. Eigenes dokument-shaped Entity (Mirror von
-- lagebericht/0038); editierbarer Entwurf, bei Freigabe unveränderlicher Snapshot als
-- etb_eintrag (typ='anordnung'). UI-seitig im auftraege-Modul (Tab), datenmodell eigenständig.
CREATE TABLE befehl (
    id                 INTEGER PRIMARY KEY,
    einsatz_id         INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    vorlage            TEXT NOT NULL
                       CHECK (vorlage IN ('befehl_lad','befehl_ladef','befehl_schnee','befehl_ea_zmw')),
    titel              TEXT NOT NULL,
    zeitstand          TEXT NOT NULL,            -- beschriebener Befehls-Zeitpunkt (SQLite-Format)
    status             TEXT NOT NULL DEFAULT 'entwurf'
                       CHECK (status IN ('entwurf','freigegeben')),
    -- Gefüllte Abschnitte als JSON-Array [{schluessel, text}], Reihenfolge = Vorlage.
    abschnitte         TEXT NOT NULL,
    version            INTEGER NOT NULL DEFAULT 1,
    vorgaenger_id      INTEGER REFERENCES befehl(id),  -- Fortschreibungs-Kette
    ersteller_id       INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at        TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_at    TEXT NOT NULL DEFAULT (datetime('now')),
    freigegeben_von_id INTEGER REFERENCES benutzer(id),
    freigegeben_at     TEXT,
    etb_eintrag_id     INTEGER REFERENCES etb_eintrag(id)   -- gesetzt bei Freigabe
);

CREATE INDEX idx_befehl_einsatz ON befehl(einsatz_id, status, zeitstand);

-- Additive Rückverlinkung in der ETB-Timeline (Badge "Befehl"). Nullable ADD COLUMN
-- ist sicher und berührt die FTS-Trigger nicht.
ALTER TABLE etb_eintrag ADD COLUMN befehl_id INTEGER REFERENCES befehl(id);
