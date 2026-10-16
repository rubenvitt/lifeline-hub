-- LLH-1085: Kräfte aus dem Bereitstellungsraum abrufen und an Abschnitt oder Auftrag übergeben
-- (Change lwxpacsf-br-kraefte-abrufen-uebergeben, design.md D4/D5/D10).
--
-- Neue Arten im art-CHECK: 'abruf' (die Führung ruft eine Kraft ab, sie bleibt im Raum, bis der
-- Austritt das Ausrücken bucht) und 'abruf_aufgehoben' (Rücknahme eines Fehlabrufs). Neue Spalten,
-- nur an einem Abruf gesetzt:
--   ziel_abschnitt_id  Bezug auf den Ziel-Abschnitt; fällt beim Löschen des Abschnitts weg.
--   ziel_anzeige       Name des Abschnitts zum Zeitpunkt des Abrufs (Schnappschuss, bleibt).
--   auftrag_id         Auftrag, der mit dem Abruf erteilt wurde.
--   mit_abruf_id       Abruf der Einheit, mit der eine Untereinheit abgerufen wurde (Verband).
--                      Ohne Fremdschlüssel: ein Selbstbezug machte die Tabelle zum Ziel eines FK
--                      und jeden späteren Neubau zum Nicht-Blatt; die Reihe ist append-only.
--
-- SQLite ändert einen CHECK nur per Neubau. br_belegung ist ein Blatt (keine Tabelle verweist
-- darauf; `grep -l br_belegung migrations/*.sql`: 0061, 0130 nur im Kommentar, 0207) → kein
-- PRAGMA-foreign_keys-Umschalter, das DROP löst keine Kaskade aus. Anders als 0169 ohne
-- `-- no-transaction`: der Neubau läuft wie 0207 in der Transaktion der Migration und fällt bei
-- einem Fehler ganz zurück. Die Tabelle trägt AUTOINCREMENT → der sqlite_sequence-Eintrag wird
-- VOR dem DROP umgehängt (Muster 0112/0169), sonst vergäbe SQLite nach dem Löschen der höchsten
-- Zeile (Einsatz gelöscht) deren id erneut.
-- Schema = 0061 + client_id aus 0207; client_id und ihr Unique-Teilindex bleiben unverändert
-- (Guard db::tests::migration_0207_br_belegung_client_id).
-- Abgesichert von db::tests::migration_0208_br_belegung_neubau_erhaelt_zeilen_sequenz_und_schema.

CREATE TABLE br_belegung_neu (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id        INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    br_id             INTEGER NOT NULL REFERENCES bereitstellungsraum(id),
    objekt_typ        TEXT    NOT NULL CHECK (objekt_typ IN ('einheit','fahrzeug')),
    objekt_id         INTEGER NOT NULL,                  -- einsatz_einheit.id ODER einsatz_fahrzeug.id (Code-Guard, kein FK)
    art               TEXT    NOT NULL
                      CHECK (art IN ('eintritt','wechsel','austritt','abruf','abruf_aufgehoben')),
    notiz             TEXT,
    zeitpunkt_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von       INTEGER NOT NULL REFERENCES benutzer(id),
    client_id         TEXT,
    ziel_abschnitt_id INTEGER REFERENCES einsatzabschnitt(id) ON DELETE SET NULL,
    ziel_anzeige      TEXT,
    auftrag_id        INTEGER REFERENCES auftrag(id) ON DELETE SET NULL,
    mit_abruf_id      INTEGER,
    CHECK (art = 'abruf' OR (ziel_abschnitt_id IS NULL AND ziel_anzeige IS NULL
                             AND auftrag_id IS NULL AND mit_abruf_id IS NULL)),
    CHECK (mit_abruf_id IS NULL OR (ziel_abschnitt_id IS NULL AND ziel_anzeige IS NULL
                                    AND auftrag_id IS NULL))
);

INSERT INTO br_belegung_neu
    (id, einsatz_id, br_id, objekt_typ, objekt_id, art, notiz, zeitpunkt_at, erfasst_von,
     client_id)
    SELECT id, einsatz_id, br_id, objekt_typ, objekt_id, art, notiz, zeitpunkt_at, erfasst_von,
           client_id
    FROM br_belegung
    ORDER BY id;

-- Sequenz der Alt-Tabelle übernehmen, bevor DROP ihren Eintrag entfernt (Begründung in 0112).
DELETE FROM sqlite_sequence
 WHERE name = 'br_belegung_neu'
   AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'br_belegung');
INSERT INTO sqlite_sequence (name, seq)
    SELECT 'br_belegung_neu', seq FROM sqlite_sequence WHERE name = 'br_belegung';

DROP TABLE br_belegung;

ALTER TABLE br_belegung_neu RENAME TO br_belegung;

-- No-op, falls SQLite den Eintrag beim RENAME bereits mitzieht (wie in 0082).
UPDATE sqlite_sequence SET name = 'br_belegung' WHERE name = 'br_belegung_neu';

-- Die Indizes aus 0061 und 0207 fallen mit dem DROP; wortgleich neu.
CREATE INDEX idx_br_belegung_br     ON br_belegung (br_id, zeitpunkt_at);
CREATE INDEX idx_br_belegung_objekt ON br_belegung (objekt_typ, objekt_id, zeitpunkt_at);
CREATE UNIQUE INDEX idx_br_belegung_client_id
    ON br_belegung(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;
-- Neu: die SET-NULL-Aktionen beim Löschen eines Abschnitts oder Auftrags suchen sonst die ganze
-- Tabelle ab.
CREATE INDEX idx_br_belegung_ziel_abschnitt ON br_belegung (ziel_abschnitt_id)
    WHERE ziel_abschnitt_id IS NOT NULL;
CREATE INDEX idx_br_belegung_auftrag ON br_belegung (auftrag_id)
    WHERE auftrag_id IS NOT NULL;
