-- no-transaction
-- LFH-836: Freie Lagekarten-Zeichen speichern die kanonische Zeichenbeschreibung von
-- @einsatzzeichen (`serializeAnySpec`, Hülle {"v":1,"spec":{…}} oder {"v":1,"freestanding":{…}})
-- in der neuen Spalte `zeichen_spec`. Die Altspalten bleiben für den Bestand und für Clients mit
-- altem Body (Übergang, design.md D4); `grundzeichen` wird dafür nullable. Ein CHECK verlangt
-- genau eine Form: Zeichenbeschreibung ODER Grundzeichen. Kein Backfill (design.md D5: der
-- Übersetzer steht in TypeScript). Herleitung:
-- openspec/changes/archive/2026-10-11-lfh-836-freie-zeichen-einsatzzeichen/design.md, D2.
--
-- SQLite kann weder NOT NULL lösen noch einen CHECK nachrüsten → Rebuild, FK-sicher nach dem
-- Muster von 0082/0119. Leaf-Rebuild: KEIN Fremdschlüssel zeigt auf freies_zeichen, keine
-- Trigger, keine Views. Effektives Schema = 0085 + ansicht_id (0094): 17 Spalten, ein Index.
-- `INTEGER PRIMARY KEY` ohne AUTOINCREMENT → kein sqlite_sequence-Nachzug. Die ids bleiben 1:1.

PRAGMA foreign_keys = OFF;

CREATE TABLE freies_zeichen_new (
    id            INTEGER PRIMARY KEY,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    lat           REAL NOT NULL,
    lon           REAL NOT NULL,
    grundzeichen  TEXT,            -- Altform; NULL, wenn zeichen_spec gesetzt ist
    organisation  TEXT,
    fachaufgabe   TEXT,
    symbol        TEXT,
    einheit       TEXT,
    funktion      TEXT,
    farbe         TEXT,
    label         TEXT,
    erstellt_von  INTEGER REFERENCES benutzer(id),
    erstellt_at   TEXT NOT NULL DEFAULT (datetime('now')),
    geaendert_at  TEXT NOT NULL DEFAULT (datetime('now')),
    ansicht_id    INTEGER REFERENCES karten_ansicht(id) ON DELETE SET NULL,   -- 0094
    -- LFH-836: kanonische Zeichenbeschreibung, vom Server auf Form und Werte geprüft
    -- (src/freies_zeichen/pruefung.rs), unverändert gespeichert, wie der Client sie sendet.
    zeichen_spec  TEXT,
    CHECK ((zeichen_spec IS NULL) <> (grundzeichen IS NULL))
);

INSERT INTO freies_zeichen_new
    (id, einsatz_id, lat, lon, grundzeichen, organisation, fachaufgabe, symbol, einheit,
     funktion, farbe, label, erstellt_von, erstellt_at, geaendert_at, ansicht_id)
    SELECT id, einsatz_id, lat, lon, grundzeichen, organisation, fachaufgabe, symbol, einheit,
           funktion, farbe, label, erstellt_von, erstellt_at, geaendert_at, ansicht_id
    FROM freies_zeichen;

DROP TABLE freies_zeichen;

ALTER TABLE freies_zeichen_new RENAME TO freies_zeichen;

CREATE INDEX idx_freies_zeichen_einsatz ON freies_zeichen(einsatz_id);

PRAGMA foreign_keys = ON;
