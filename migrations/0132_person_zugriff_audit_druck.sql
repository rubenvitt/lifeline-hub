-- no-transaction
-- LFH-727: Protokollart 'druck' im CHECK von person_zugriff_audit (design.md D1/D2). Der Abruf
-- der Personen-Druckansicht (GET …/personen/druck) schreibt je Abruf eine Zeile, person_id NULL
-- wie beim Export der gesamten Liste. Der Spaltenkommentar bleibt wortgleich zu 0021 (die DDL
-- trägt ihn mit, der Test vergleicht sie).
--
-- SQLite ändert einen Spalten-CHECK nur per Tabellen-Rebuild. person_zugriff_audit ist Leaf
-- (keine Tabelle verweist darauf, gemessen per grep über migrations/) → kein
-- PRAGMA-foreign_keys-Toggle nötig, das DROP löst keine Kaskade aus (Muster 0112).
-- Die Tabelle trägt AUTOINCREMENT → der sqlite_sequence-Eintrag wird umgehängt, sonst
-- vergäbe SQLite nach dem Löschen der höchsten Zeile deren id erneut.
-- Schema = 0021 1:1 (keine späteren ADD COLUMN), einzige Änderung ist der art-CHECK.
-- Abgesichert von db::tests::migration_0132_* (include_str!).

CREATE TABLE person_zugriff_audit_neu (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id  INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id   INTEGER REFERENCES einsatz_person(id),  -- NULL bei Export gesamter Liste
    benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
    art         TEXT    NOT NULL CHECK (art IN ('detail','export','druck')),
    zugriff_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
);

INSERT INTO person_zugriff_audit_neu (id, einsatz_id, person_id, benutzer_id, art, zugriff_at)
    SELECT id, einsatz_id, person_id, benutzer_id, art, zugriff_at
    FROM person_zugriff_audit;

-- Sequenz der Alt-Tabelle übernehmen, bevor DROP ihren Eintrag entfernt (Begründung in 0112).
DELETE FROM sqlite_sequence
 WHERE name = 'person_zugriff_audit_neu'
   AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'person_zugriff_audit');
INSERT INTO sqlite_sequence (name, seq)
    SELECT 'person_zugriff_audit_neu', seq FROM sqlite_sequence WHERE name = 'person_zugriff_audit';

DROP TABLE person_zugriff_audit;

ALTER TABLE person_zugriff_audit_neu RENAME TO person_zugriff_audit;

-- No-op, falls SQLite den Eintrag beim RENAME bereits mitzieht (wie in 0082).
UPDATE sqlite_sequence SET name = 'person_zugriff_audit' WHERE name = 'person_zugriff_audit_neu';

CREATE INDEX idx_person_audit_einsatz ON person_zugriff_audit (einsatz_id, zugriff_at);
