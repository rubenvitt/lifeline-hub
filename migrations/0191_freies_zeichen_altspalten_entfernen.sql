-- no-transaction
-- LLH-1160: Ende des Übergangs aus LFH-836 (design.md D4, Open Questions der archivierten Change
-- `lfh-836-freie-zeichen-einsatzzeichen`). Der Server nimmt nur noch `zeichen_spec` an; die
-- Altspalten `grundzeichen`, `organisation`, `fachaufgabe`, `symbol`, `einheit`, `funktion` und
-- `farbe` entfallen, `zeichen_spec` wird NOT NULL.
--
-- Altzeilen: Der Übersetzer der Altform steht in TypeScript (`frontend/src/zeichen/freiesZeichen.ts`)
-- und hängt daran, was die Bibliothek zeichnen kann; das Server-Image hat keine JS-Laufzeit. Die
-- Migration schreibt die Altwerte deshalb unverändert als Hülle `{"v":1,"alt":{…}}` in
-- `zeichen_spec` (nur gesetzte Felder; `json_patch` lässt NULL weg). Der Leseadapter des Clients
-- übersetzt die Hülle wie bisher die Altspalten; er bleibt ohnehin für die Lage-Snapshots, die im
-- Altformat eingefroren sind. Beim nächsten Ändern schreibt der Client eine echte Spec. Von außen
-- nimmt der Server die Hülle nicht an (`freies_zeichen::pruefung`: genau eines von `spec` und
-- `freestanding`).
--
-- SQLite kann weder eine Spalte aus einem CHECK lösen noch NOT NULL nachrüsten → Rebuild,
-- FK-sicher nach dem Muster von 0176. Leaf-Rebuild: KEIN Fremdschlüssel zeigt auf freies_zeichen,
-- keine Trigger, keine Views. `INTEGER PRIMARY KEY` ohne AUTOINCREMENT → kein
-- sqlite_sequence-Nachzug. Die ids bleiben 1:1.

PRAGMA foreign_keys = OFF;

CREATE TABLE freies_zeichen_new (
    id            INTEGER PRIMARY KEY,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    lat           REAL NOT NULL,
    lon           REAL NOT NULL,
    -- LFH-836: kanonische Zeichenbeschreibung, vom Server auf Form und Werte geprüft
    -- (src/freies_zeichen/pruefung.rs), unverändert gespeichert, wie der Client sie sendet.
    -- LLH-1160: bei Altzeilen die Hülle {"v":1,"alt":{…}} aus dieser Migration.
    zeichen_spec  TEXT NOT NULL,
    label         TEXT,
    erstellt_von  INTEGER REFERENCES benutzer(id),
    erstellt_at   TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at  TEXT NOT NULL DEFAULT (datetime('now')),
    ansicht_id    INTEGER REFERENCES karten_ansicht(id) ON DELETE SET NULL    -- 0094
);

INSERT INTO freies_zeichen_new
    (id, einsatz_id, lat, lon, zeichen_spec, label, erstellt_von, erstellt_at, geaendert_at,
     ansicht_id)
    SELECT id, einsatz_id, lat, lon,
           COALESCE(
               zeichen_spec,
               json_object(
                   'v', 1,
                   'alt', json(json_patch('{}', json_object(
                       'grundzeichen', grundzeichen,
                       'organisation', organisation,
                       'fachaufgabe', fachaufgabe,
                       'symbol', symbol,
                       'einheit', einheit,
                       'funktion', funktion,
                       'farbe', farbe
                   )))
               )
           ),
           label, erstellt_von, erstellt_at, geaendert_at, ansicht_id
    FROM freies_zeichen;

DROP TABLE freies_zeichen;

ALTER TABLE freies_zeichen_new RENAME TO freies_zeichen;

CREATE INDEX idx_freies_zeichen_einsatz ON freies_zeichen(einsatz_id);

PRAGMA foreign_keys = ON;
