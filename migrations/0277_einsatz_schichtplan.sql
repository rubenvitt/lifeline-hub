-- LLH-1552 (Folge aus LLH-1523, Change `x9t2i7k9-planschichten-einsatz`): der Schichtplan eines
-- Einsatzes. Der Plan ist Soll: er ändert keine Zuordnung, keine Fälligkeit und keinen Status.
--
-- 1. `einsatz_plan_helfer` — Helfer des Plans (Name, Telefon, Organisation, Qualifikationen), wie
--    die temporären Helfer der Suite. Wer nur hier steht, ist nicht im Einsatz: keine
--    Alarmierung, keine Stärke, keine Zeitachse. `qualifikationen` ist eine JSON-Liste von
--    `qualifikation.id` (höchstens 20, nur der eigenen Organisation; prüft Rust).
--
-- 2. `einsatz_planschicht` — ein Block an einem Posten: einer Einheit des Einsatzes, einer UHS
--    oder der Zeile „Pause“ (genau die zur Art passende Spalte gesetzt). `von`/`bis` im
--    kanonischen UTC-Format (`src/zeit.rs`), Raster 5 min, 10 min bis 24 h, keine Überschneidung
--    je Posten außer der Pause — das prüft Rust in der schreibenden Transaktion. Das Soll ist eine
--    Kopie der Vorgabe des Postens beim Anlegen (`soll_anzahl` 1 bis 200, `quali_soll` in der Form
--    von 0276); die Pause hat keins. `version` ist der CAS-Zähler (409).
--
-- 3. `einsatz_planschicht_person` — die eingeteilten Personen eines Blocks: Stamm-Personal der
--    Organisation (`personal_id`, auch wenn nicht disponiert), eine Ad-hoc-Kraft des Einsatzes
--    (`einsatz_personal_id`) oder ein Helfer des Plans (`helfer_id`); genau eins davon, je Block
--    und Person einmal.
--
-- 4. `einsatz_einstellungen.schichtplan_max_dienst_min` (60 bis 1440) und
--    `schichtplan_min_ruhe_min` (0 bis 1440): Grenzwerte des Dienst-Befunds; NULL = Vorgabe
--    720 / 480 wie die Suite. Ohne CHECK wie jede Spalte der Leaf-Tabelle (0064), die Bereiche
--    prüft Rust.
--
-- Fremdschlüssel: Einsatz, Posten, Block, Ad-hoc-Kraft und Helfer CASCADE; `personal` NO ACTION
-- wie jeder Verweis auf die Stammdaten (`src/demo/schema_tests.rs`). Abgesichert von
-- db::tests::migration_0277_einsatz_schichtplan.
CREATE TABLE einsatz_plan_helfer (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    telefon         TEXT,
    organisation    TEXT,
    qualifikationen TEXT
        CHECK (qualifikationen IS NULL
            OR (json_valid(qualifikationen) AND json_type(qualifikationen) = 'array')),
    angelegt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    angelegt_von    INTEGER REFERENCES benutzer(id)
);
CREATE INDEX idx_plan_helfer_einsatz ON einsatz_plan_helfer(einsatz_id);

CREATE TABLE einsatz_planschicht (
    id           INTEGER PRIMARY KEY,
    einsatz_id   INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    posten_art   TEXT    NOT NULL CHECK (posten_art IN ('einheit', 'uhs', 'pause')),
    einheit_id   INTEGER REFERENCES einsatz_einheit(id) ON DELETE CASCADE,
    uhs_id       INTEGER REFERENCES uhs(id) ON DELETE CASCADE,
    von          TEXT    NOT NULL,
    bis          TEXT    NOT NULL,
    soll_anzahl  INTEGER CHECK (soll_anzahl IS NULL OR soll_anzahl BETWEEN 1 AND 200),
    quali_soll   TEXT
        CHECK (quali_soll IS NULL OR (json_valid(quali_soll) AND json_type(quali_soll) = 'array')),
    notiz        TEXT,
    version      INTEGER NOT NULL DEFAULT 1,
    angelegt_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    angelegt_von INTEGER REFERENCES benutzer(id),
    geaendert_at TEXT,
    geaendert_von INTEGER REFERENCES benutzer(id),
    CHECK (
        (posten_art = 'einheit' AND einheit_id IS NOT NULL AND uhs_id IS NULL)
        OR (posten_art = 'uhs' AND uhs_id IS NOT NULL AND einheit_id IS NULL)
        OR (posten_art = 'pause' AND einheit_id IS NULL AND uhs_id IS NULL)
    ),
    CHECK (bis > von),
    CHECK (posten_art <> 'pause' OR (soll_anzahl IS NULL AND quali_soll IS NULL))
);
CREATE INDEX idx_planschicht_posten
    ON einsatz_planschicht(einsatz_id, posten_art, einheit_id, uhs_id, von);
CREATE INDEX idx_planschicht_einheit ON einsatz_planschicht(einheit_id);
CREATE INDEX idx_planschicht_uhs ON einsatz_planschicht(uhs_id);

CREATE TABLE einsatz_planschicht_person (
    planschicht_id      INTEGER NOT NULL REFERENCES einsatz_planschicht(id) ON DELETE CASCADE,
    personal_id         INTEGER REFERENCES personal(id),
    einsatz_personal_id INTEGER REFERENCES einsatz_personal(id) ON DELETE CASCADE,
    helfer_id           INTEGER REFERENCES einsatz_plan_helfer(id) ON DELETE CASCADE,
    CHECK ((personal_id IS NOT NULL) + (einsatz_personal_id IS NOT NULL)
        + (helfer_id IS NOT NULL) = 1)
);
CREATE UNIQUE INDEX uq_planschicht_person_stamm
    ON einsatz_planschicht_person(planschicht_id, personal_id) WHERE personal_id IS NOT NULL;
CREATE UNIQUE INDEX uq_planschicht_person_einsatz
    ON einsatz_planschicht_person(planschicht_id, einsatz_personal_id)
    WHERE einsatz_personal_id IS NOT NULL;
CREATE UNIQUE INDEX uq_planschicht_person_helfer
    ON einsatz_planschicht_person(planschicht_id, helfer_id) WHERE helfer_id IS NOT NULL;
CREATE INDEX idx_planschicht_person_stamm ON einsatz_planschicht_person(personal_id);
CREATE INDEX idx_planschicht_person_einsatz ON einsatz_planschicht_person(einsatz_personal_id);
CREATE INDEX idx_planschicht_person_helfer ON einsatz_planschicht_person(helfer_id);

ALTER TABLE einsatz_einstellungen ADD COLUMN schichtplan_max_dienst_min INTEGER;
ALTER TABLE einsatz_einstellungen ADD COLUMN schichtplan_min_ruhe_min INTEGER;
