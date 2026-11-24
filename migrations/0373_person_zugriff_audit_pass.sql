-- LLH-1198: Protokollarten 'pass_export' und 'pass_druck' im CHECK von person_zugriff_audit
-- (Entwurf docs/superpowers/specs/2026-11-24-sco62ku3-pass-liste-design.md). Der Abruf der
-- PASS-Liste (GET …/persons/export?profile=pass bzw. …/persons/print?profile=pass) schreibt je
-- Abruf eine Zeile ohne person_id, getrennt von 'export' und 'druck', damit das Protokoll den
-- Export an die Personenauskunftsstelle unterscheidet (Entscheidung 24.11.2026). Der
-- Spaltenkommentar bleibt wortgleich zu 0021/0132/0141/0311 (die DDL trägt ihn mit, der Test
-- vergleicht sie).
--
-- SQLite ändert einen Spalten-CHECK nur per Tabellen-Rebuild; Muster wie 0311 (Blatt-Tabelle
-- ohne Verweise, AUTOINCREMENT-Sequenz umgehängt), aber ohne den Marker no-transaction: ein
-- Blatt-Umbau läuft in der Transaktion von sqlx (migrations/AGENTS.md, „Tabellenumbau“).
-- Schema = 0311 1:1, einzige Änderung ist der art-CHECK.
-- Abgesichert von db::tests::migration_0373_* (include_str!).

CREATE TABLE person_zugriff_audit_neu (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id  INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id   INTEGER REFERENCES einsatz_person(id),  -- NULL bei Export gesamter Liste
    benutzer_id INTEGER NOT NULL REFERENCES benutzer(id),
    art         TEXT    NOT NULL CHECK (art IN ('detail','export','druck','anhang','registrierliste','pass_export','pass_druck')),
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
