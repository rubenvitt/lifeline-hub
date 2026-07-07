-- no-transaction
-- LFH-119 / LFH-174: uhs-typ-CHECK FK-sicher rebuilden — 'bereitstellungsraum' aus dem
-- DB-CHECK entfernen. Nachzug zu 0062, das nur die Altdaten bereinigte (typ → 'sonstige')
-- und den CHECK-Rebuild BEWUSST zurückstellte: sqlx-sqlite 0.8.6 wickelte jede Migration
-- in eine eigene Transaktion und ignorierte `-- no-transaction` fürs SQLite-Backend →
-- `PRAGMA foreign_keys = OFF` war darin ein No-op (SQLite: FK-Toggle in offener Tx
-- wirkungslos). sqlx 0.9 (LFH-163) honoriert die Direktive, daher ist der FK-sichere
-- Rebuild jetzt machbar (Muster wie 0078/0079).
--
-- Nicht-Leaf-CHECK-Rebuild: uhs trägt eingehende FKs
--   uhs_platz.uhs_id            (ON DELETE CASCADE)
--   person_uhs_belegung.uhs_id  (NOT NULL)
--   einsatz_person.aktuelle_uhs_id / einsatz_material.uhs_id (nullable)
-- PRAGMA foreign_keys = OFF verhindert, dass DROP TABLE uhs CASCADE/FK-Fehler auslöst.
-- Die ids bleiben beim Copy 1:1 erhalten, sodass alle Kind-FKs nach dem Rename weiter
-- auflösen. Effektives Schema = 0027 + lat/lon (0034) — vollständig reproduziert.

PRAGMA foreign_keys = OFF;

-- Sicherheitsnetz: zwischen 0062 und hier hätte (bei erlaubtem CHECK) ein Altwert
-- reinkommen können; der bräche sonst den Copy am neuen CHECK. Idempotent, No-op auf
-- sauberen DBs (vgl. 0079: DELETE der protomaps-Zeilen vor dem Rebuild).
UPDATE uhs SET typ = 'sonstige' WHERE typ = 'bereitstellungsraum';

CREATE TABLE uhs_new (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    abschnitt_id  INTEGER REFERENCES einsatzabschnitt(id),
    typ           TEXT    NOT NULL
                  CHECK (typ IN ('patientenablage','behandlungsplatz',
                                 'verletztensammelstelle','sonstige')),
    bezeichnung   TEXT    NOT NULL,                  -- "PA 1", "BHP 50"
    standort      TEXT,                              -- Freitext (Adresse/Hinweis)
    notiz         TEXT,
    status        TEXT    NOT NULL DEFAULT 'geplant'
                  CHECK (status IN ('geplant','aktiv','aufgeloest')),
    erfasst_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von   INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_von INTEGER NOT NULL REFERENCES benutzer(id),
    storniert_at  TEXT,                              -- Soft-Delete (Fehleingabe)
    lat           REAL,                              -- 0034_lage_geo
    lon           REAL,                              -- 0034_lage_geo
    UNIQUE (einsatz_id, bezeichnung)
);

INSERT INTO uhs_new
    SELECT id, einsatz_id, abschnitt_id, typ, bezeichnung, standort, notiz, status,
           erfasst_at, erfasst_von, geaendert_at, geaendert_von, storniert_at, lat, lon
    FROM uhs;

DROP TABLE uhs;

ALTER TABLE uhs_new RENAME TO uhs;

-- AUTOINCREMENT-Semantik erhalten (kein id-Reuse nach Löschen der höchsten Zeile): den
-- sqlite_sequence-Eintrag der umbenannten Tabelle nachziehen. No-op, falls SQLite ihn beim
-- RENAME bereits mitzieht oder die Tabelle leer ist (dann existiert kein 'uhs_new'-Eintrag).
UPDATE sqlite_sequence SET name = 'uhs' WHERE name = 'uhs_new';

CREATE INDEX idx_uhs_einsatz ON uhs (einsatz_id, status);
CREATE INDEX idx_uhs_abschnitt ON uhs (abschnitt_id);

PRAGMA foreign_keys = ON;
