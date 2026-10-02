-- LFH-750: Endgültige Löschung des pseudonymen Skeletts geschwärzter Einsätze.
-- Herleitung: openspec/changes/lfh-750-skelett-endgueltig-loeschen/design.md (D1, D4, D5).

-- Skelett-Frist der Organisation in Tagen ab Abschluss; NULL = das Skelett bleibt unbegrenzt
-- erhalten. Validierung (1…36500) in Rust, kein DB-CHECK — wie retention_dauer_tage.
ALTER TABLE org_einstellungen ADD COLUMN skelett_dauer_tage INTEGER;

-- Einzige Spur eines endgültig gelöschten Einsatzes: sein ETB verschwindet mit. Keine
-- Bezeichnung, kein Stichwort, kein Ort, kein ETB-Text. `einsatz_id` bewusst ohne FK — die
-- Zeile sperrt ID und Einsatznummer gegen die Wiedervergabe (einsatz::repo::anlegen_tx).
CREATE TABLE aufbewahrung_loeschprotokoll (
    id                   INTEGER PRIMARY KEY,
    org_id               INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    einsatz_id           INTEGER NOT NULL UNIQUE,
    einsatznummer_intern TEXT,
    nummer_jahr          INTEGER,
    nummer_lfd           INTEGER,
    abgeschlossen_at     TEXT,
    geschwaerzt_at       TEXT    NOT NULL,
    geloescht_at         TEXT    NOT NULL,
    skelett_dauer_tage   INTEGER NOT NULL,
    akteur_id            INTEGER NOT NULL REFERENCES benutzer(id)
);

CREATE INDEX idx_aufbewahrung_loeschprotokoll_org ON aufbewahrung_loeschprotokoll(org_id);
