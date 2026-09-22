-- no-transaction
-- LFH-613: Verbleib-Art 'notunterkunft' im CHECK von person_verbleib (design.md D3).
--
-- SQLite ändert einen Spalten-CHECK nur per Tabellen-Rebuild. person_verbleib ist Leaf
-- (keine Tabelle verweist darauf, gemessen per grep über migrations/) → kein
-- PRAGMA-foreign_keys-Toggle nötig, das DROP löst keine Kaskade aus (Präzedenz 0033).
-- Die Tabelle trägt AUTOINCREMENT → der sqlite_sequence-Eintrag wird umgehängt, sonst
-- vergäbe SQLite nach dem Löschen der höchsten Zeile deren id erneut.
-- Schema = 0025 1:1 (keine späteren ADD COLUMN), einzige Änderung ist der art-CHECK.
-- Abgesichert von db::tests::migration_0112_person_verbleib_rebuild_* (include_str!).

CREATE TABLE person_verbleib_neu (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id      INTEGER NOT NULL REFERENCES einsatz_person(id),
    art            TEXT    NOT NULL
                   CHECK (art IN ('transport','entlassung','vor_ort','verstorben','notunterkunft')),
    transportmittel TEXT,                     -- Freitext (RTW, KTW, …), optional
    ziel           TEXT,                      -- Freitext-Krankenhaus/Ziel, optional
    status         TEXT
                   CHECK (status IS NULL OR status IN ('angemeldet','abtransportiert')),
    notiz          TEXT,
    zeitpunkt_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von    INTEGER NOT NULL REFERENCES benutzer(id)
);

INSERT INTO person_verbleib_neu
    (id, einsatz_id, person_id, art, transportmittel, ziel, status, notiz,
     zeitpunkt_at, erfasst_von)
    SELECT id, einsatz_id, person_id, art, transportmittel, ziel, status, notiz,
           zeitpunkt_at, erfasst_von
    FROM person_verbleib;

-- Sequenz der Alt-Tabelle übernehmen, bevor DROP ihren Eintrag entfernt. Der Copy setzt die
-- Sequenz der neuen Tabelle nur auf MAX(id); nach dem Löschen der höchsten Zeile (oder aller
-- Zeilen) liegt die alte darüber, und genau dieser Abstand darf nicht verloren gehen. Die alte
-- Sequenz ist nie kleiner als MAX(id) der kopierten Zeilen, sie gewinnt also immer.
DELETE FROM sqlite_sequence
 WHERE name = 'person_verbleib_neu'
   AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'person_verbleib');
INSERT INTO sqlite_sequence (name, seq)
    SELECT 'person_verbleib_neu', seq FROM sqlite_sequence WHERE name = 'person_verbleib';

DROP TABLE person_verbleib;

ALTER TABLE person_verbleib_neu RENAME TO person_verbleib;

-- No-op, falls SQLite den Eintrag beim RENAME bereits mitzieht (wie in 0082).
UPDATE sqlite_sequence SET name = 'person_verbleib' WHERE name = 'person_verbleib_neu';

CREATE INDEX idx_person_verbleib_person ON person_verbleib (person_id, zeitpunkt_at);
