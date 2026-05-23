-- ETB-Eintrag: append-only Einsatztagebuch. Einträge sind nach dem Anlegen
-- unveränderlich (kein UPDATE/DELETE); Korrekturen erfolgen als neuer
-- Berichtigungseintrag (typ='berichtigung'), der den fehlerhaften Eintrag
-- referenziert. lfd_nr ist server-autoritativ und lückenlos pro Einsatz.
CREATE TABLE etb_eintrag (
    id                    INTEGER PRIMARY KEY,
    einsatz_id            INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    lfd_nr                INTEGER NOT NULL,
    typ                   TEXT NOT NULL
                          CHECK (typ IN ('meldung','anordnung','lage','entscheidung','system','berichtigung')),
    inhalt                TEXT NOT NULL,
    von                   TEXT,
    an                    TEXT,
    meldeweg              TEXT
                          CHECK (meldeweg IS NULL OR meldeweg IN ('funk','telefon','persoenlich','sonstige')),
    veranlassung          TEXT,
    erfasser_id           INTEGER NOT NULL REFERENCES benutzer(id),
    -- Zeitmodell (Spec §11): ereigniszeit = Anzeige-Sortierung (Client/Default jetzt),
    -- received_at = autoritativ (Server), erfasst_lokal_at = beratend (Client, optional).
    ereigniszeit          TEXT NOT NULL,
    received_at           TEXT NOT NULL DEFAULT (datetime('now')),
    erfasst_lokal_at      TEXT,
    berichtigt_eintrag_id INTEGER REFERENCES etb_eintrag(id),
    UNIQUE (einsatz_id, lfd_nr)
);

-- Filter nach Ereigniszeitraum innerhalb eines Einsatzes.
-- (Die Cursor-/Sortier-Query nach lfd_nr nutzt den UNIQUE-Index (einsatz_id, lfd_nr).)
CREATE INDEX idx_etb_einsatz_ereigniszeit ON etb_eintrag(einsatz_id, ereigniszeit);

-- FTS5-Volltextindex über Inhalt + Beteiligte. External-content: der Index
-- verweist per rowid auf etb_eintrag(id). Append-only → nur AFTER INSERT nötig.
CREATE VIRTUAL TABLE etb_eintrag_fts USING fts5(
    inhalt,
    von,
    an,
    veranlassung,
    content='etb_eintrag',
    content_rowid='id'
);

CREATE TRIGGER etb_eintrag_fts_ai AFTER INSERT ON etb_eintrag BEGIN
    INSERT INTO etb_eintrag_fts (rowid, inhalt, von, an, veranlassung)
    VALUES (new.id, new.inhalt, new.von, new.an, new.veranlassung);
END;
