-- no-transaction
-- LFH-673: Zonentyp 'evakuierungsbezirk' und Verweis Zone → Bezirk (n : 1, Vorbild
-- `gefahrengebiet_id` aus 0041). Der erste Rebuild von lage_zone: der Typ steht im CHECK,
-- SQLite kann einen CHECK nicht ändern. FK-sicher nach dem Muster von 0082.
--
-- Leaf-Rebuild: bis hierher zeigt KEIN Fremdschlüssel auf lage_zone. Die neue Spalte entsteht
-- direkt in `lage_zone_new` — so zeigt auch während des Umbaus nichts auf die Tabelle, und
-- `evakuierungsbezirk` ist nur Ziel, nicht Quelle eines Verweises.
--
-- Effektives Schema = 0036 + gefahrengebiet_id (0041) + ansicht_id (0095), abgelesen aus
-- `PRAGMA table_info`/`sqlite_master` einer migrierten DB (nicht aus den Migrationen
-- nachgebaut): 13 Spalten, zwei Indizes, keine Trigger, keine Views. `INTEGER PRIMARY KEY`
-- ohne AUTOINCREMENT → kein sqlite_sequence-Nachzug. Die ids bleiben 1:1 erhalten.

PRAGMA foreign_keys = OFF;

CREATE TABLE lage_zone_new (
    id            INTEGER PRIMARY KEY,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    typ           TEXT NOT NULL
                    CHECK (typ IN ('gefahrengebiet','absperrbereich','absperrgrenze',
                                   'sperrgebiet','freie_skizze','evakuierungsbezirk')),
    geometrie_typ TEXT NOT NULL
                    CHECK (geometrie_typ IN ('Polygon','LineString')),
    geometrie     TEXT NOT NULL,   -- GeoJSON-Geometry (Polygon oder LineString)
    label         TEXT,
    farbe         TEXT,            -- nur freie_skizze; sonst NULL
    notiz         TEXT,
    erstellt_von  INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at   TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at  TEXT NOT NULL DEFAULT (datetime('now')),
    gefahrengebiet_id INTEGER REFERENCES gefahrengebiet(id) ON DELETE SET NULL,   -- 0041
    ansicht_id        INTEGER REFERENCES karten_ansicht(id) ON DELETE SET NULL,   -- 0095
    -- LFH-673: nur an Zonen vom Typ 'evakuierungsbezirk' (App prüft, wie beim Gefahrengebiet).
    -- Stornieren eines Bezirks löst den Verweis in der App; SET NULL greift beim Hard-Delete.
    evakuierungsbezirk_id INTEGER REFERENCES evakuierungsbezirk(id) ON DELETE SET NULL
);

INSERT INTO lage_zone_new
    (id, einsatz_id, typ, geometrie_typ, geometrie, label, farbe, notiz, erstellt_von,
     erstellt_at, geaendert_at, gefahrengebiet_id, ansicht_id)
    SELECT id, einsatz_id, typ, geometrie_typ, geometrie, label, farbe, notiz, erstellt_von,
           erstellt_at, geaendert_at, gefahrengebiet_id, ansicht_id
    FROM lage_zone;

DROP TABLE lage_zone;

ALTER TABLE lage_zone_new RENAME TO lage_zone;

CREATE INDEX idx_lage_zone_einsatz ON lage_zone(einsatz_id);
CREATE INDEX idx_lage_zone_gebiet ON lage_zone(gefahrengebiet_id);
CREATE INDEX idx_lage_zone_evakuierungsbezirk ON lage_zone(evakuierungsbezirk_id);

PRAGMA foreign_keys = ON;
