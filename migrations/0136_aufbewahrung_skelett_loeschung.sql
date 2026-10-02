-- LFH-750: Endgültige Löschung des pseudonymen Skeletts geschwärzter Einsätze.
-- Herleitung: openspec/changes/archive/2026-10-02-lfh-750-skelett-endgueltig-loeschen/design.md (D1, D4, D5).

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

-- Der ETB-Suchindex soll Gelöschtes wirklich entfernen. Ohne die FTS5-Option `secure-delete`
-- schreibt ein 'delete' (Trigger `etb_eintrag_fts_ad`) nur Löschmarken in ein neues Segment:
-- die Wörter des ETB blieben als Tokens in `etb_eintrag_fts_data` stehen, auch nach der
-- endgültigen Löschung, und `PRAGMA secure_delete` erreicht sie nicht, weil diese Seiten
-- belegt bleiben. Die Option steht in `etb_eintrag_fts_config` und gilt damit dauerhaft;
-- `optimize` führt die Segmente einmal zusammen und räumt Reste früherer Löschungen weg.
INSERT INTO etb_eintrag_fts(etb_eintrag_fts, rank) VALUES('secure-delete', 1);
INSERT INTO etb_eintrag_fts(etb_eintrag_fts) VALUES('optimize');
