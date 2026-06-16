-- LFH-14: `bereitstellungsraum` aus dem UhsTyp-Enum entfernen.
-- `Bereitstellungsraum` ist jetzt ein eigenes Modul; der inerte Enum-Wert in der
-- UHS-Schicht (patienten-zentrisch) entfällt.
--
-- Etwaige Altdaten werden auf `sonstige` migriert. Der typ-CHECK der uhs-Tabelle
-- wird ohne `bereitstellungsraum` neu aufgebaut (SQLite-Tabellen-Rebuild).
-- uhs hat eingehende FKs (einsatz_material.uhs_id, einsatz_person.aktuelle_uhs_id,
-- uhs_platz.uhs_id) → PRAGMA foreign_keys während des Rebuilds deaktivieren.
-- Vollständiges Schema = 0027_uhs.sql + lat/lon aus 0034_lage_geo.sql.

PRAGMA foreign_keys = OFF;

-- 1. Altdaten: bereitstellungsraum → sonstige.
UPDATE uhs SET typ = 'sonstige' WHERE typ = 'bereitstellungsraum';

-- 2. Neue Tabelle mit CHECK ohne 'bereitstellungsraum';
--    vollständiges Schema inkl. lat/lon (hinzugefügt in 0034_lage_geo.sql).
CREATE TABLE uhs_neu (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    abschnitt_id  INTEGER REFERENCES einsatzabschnitt(id),
    typ           TEXT    NOT NULL
                  CHECK (typ IN ('patientenablage','behandlungsplatz',
                                 'verletztensammelstelle','sonstige')),
    bezeichnung   TEXT    NOT NULL,
    standort      TEXT,
    notiz         TEXT,
    lat           REAL,
    lon           REAL,
    status        TEXT    NOT NULL DEFAULT 'geplant'
                  CHECK (status IN ('geplant','aktiv','aufgeloest')),
    erfasst_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von   INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_von INTEGER NOT NULL REFERENCES benutzer(id),
    storniert_at  TEXT,
    UNIQUE (einsatz_id, bezeichnung)
);

-- 3. Daten übernehmen (alle Spalten explizit).
INSERT INTO uhs_neu
    (id, einsatz_id, abschnitt_id, typ, bezeichnung, standort, notiz,
     lat, lon, status, erfasst_at, erfasst_von, geaendert_at, geaendert_von, storniert_at)
SELECT
     id, einsatz_id, abschnitt_id, typ, bezeichnung, standort, notiz,
     lat, lon, status, erfasst_at, erfasst_von, geaendert_at, geaendert_von, storniert_at
FROM uhs;

-- 4. Alte Tabelle entfernen, neue umbenennen.
DROP TABLE uhs;
ALTER TABLE uhs_neu RENAME TO uhs;

-- 5. Indizes aus 0027_uhs.sql neu anlegen.
CREATE INDEX idx_uhs_einsatz   ON uhs (einsatz_id, status);
CREATE INDEX idx_uhs_abschnitt ON uhs (abschnitt_id);

PRAGMA foreign_keys = ON;
