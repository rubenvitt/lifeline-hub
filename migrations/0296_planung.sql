-- LLH-1561/LLH-1585 (Change `vu7jnr2x-vorplanung-ohne-einsatz`, Teil A): Vorplanung ohne Einsatz.
-- Eine Planung ist ein Objekt der Organisation, kein Einsatz: sie steht in keiner Einsatzliste,
-- keinem Zähler und auf keinem Lagemonitor. Schichten, Einteilungen und Helfer folgen denselben
-- Regeln wie der Schichtplan im Einsatz (0277); Rust prüft Raster, Dauer und Überschneidung in
-- der schreibenden Transaktion.
--
-- 1. `planung` — Bezeichnung (in der Org eindeutig), Einsatzart, Ort mit optionaler Koordinate
--    (nur als Paar), Zeitraum (`von` < `bis`, höchstens 14 Tage, prüft Rust), Grenzwerte des
--    Dienst-Befunds (NULL = Vorgabe 720 / 480 wie im Einsatz). AUTOINCREMENT, weil Planungen
--    echt gelöscht werden und `demo_herkunft` polymorph ohne FK auf die id zeigt (wie 0212).
--
-- 2. `planung_posten` — ein Posten der Planung: wird bei der Übernahme eine Einheit
--    (`art = 'einheit'`, frei, aus einer Einheitenvorlage oder einem Stamm-Fahrzeug) oder eine UHS
--    (`art = 'uhs'` mit UHS-Typ). `abschnitt` ist Freitext und gruppiert im Raster. Soll wie
--    0276 (`soll_anzahl` 1 bis 200, `quali_soll` als Liste), Schichtlänge 10 bis 1440 min auf
--    vollen 5 Minuten.
--
-- 3. `planung_helfer` — temporäre Helfer der Planung, Form wie `einsatz_plan_helfer` (0277).
--
-- 4. `planung_schicht` — ein Block an einem Posten oder an der Pause (`posten_id IS NULL`), Form
--    wie `einsatz_planschicht`. Die Pause hat kein Soll. `version` ist der CAS-Zähler (409).
--
-- 5. `planung_schicht_person` — Stamm-Personal der Organisation (`personal_id`) oder ein Helfer
--    der Planung (`helfer_id`); genau eins, je Block und Person einmal.
--
-- 6. `demo_herkunft.tabelle` kennt zusätzlich `planung` (Demo-Planung der Lage „Stadtfest“).
--    `demo_herkunft` ist Blatt, das DROP löst keine Kaskade aus; Schema = 0212 1:1, einzige
--    Änderung ist der CHECK (Wire-Werte von `demo::DemoStammdatenArt`).
--
-- Fremdschlüssel: innerhalb der Planung CASCADE; `organisation`, `personal`, `fahrzeug` und
-- `einheit_vorlage` NO ACTION wie jeder Verweis auf die Stammdaten (`src/demo/schema_tests.rs`).
-- Keine Spalte verweist auf einen Einsatz: die Planung liegt außerhalb der einsatz-scoped Menge
-- (Schwärzungs-Registry, GUARD 5). Abgesichert von db::tests::migration_0296_planung.
CREATE TABLE planung (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id         INTEGER NOT NULL REFERENCES organisation(id),
    bezeichnung    TEXT    NOT NULL,
    einsatzart     TEXT    NOT NULL DEFAULT 'sanitaetsdienst'
        CHECK (einsatzart IN ('realeinsatz', 'uebung', 'sanitaetsdienst', 'bereitstellung')),
    ort            TEXT,
    ort_lat        REAL,
    ort_lon        REAL,
    von            TEXT    NOT NULL,
    bis            TEXT    NOT NULL,
    max_dienst_min INTEGER CHECK (max_dienst_min IS NULL OR max_dienst_min BETWEEN 60 AND 1440),
    min_ruhe_min   INTEGER CHECK (min_ruhe_min IS NULL OR min_ruhe_min BETWEEN 0 AND 1440),
    version        INTEGER NOT NULL DEFAULT 1,
    angelegt_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    angelegt_von   INTEGER REFERENCES benutzer(id),
    geaendert_at   TEXT,
    geaendert_von  INTEGER REFERENCES benutzer(id),
    CHECK (bis > von),
    CHECK ((ort_lat IS NULL) = (ort_lon IS NULL))
);
CREATE UNIQUE INDEX uq_planung_bezeichnung ON planung(org_id, bezeichnung COLLATE NOCASE);
CREATE INDEX idx_planung_bis ON planung(bis);

CREATE TABLE planung_posten (
    id                 INTEGER PRIMARY KEY,
    planung_id         INTEGER NOT NULL REFERENCES planung(id) ON DELETE CASCADE,
    bezeichnung        TEXT    NOT NULL,
    abschnitt          TEXT,
    art                TEXT    NOT NULL CHECK (art IN ('einheit', 'uhs')),
    einheit_vorlage_id INTEGER REFERENCES einheit_vorlage(id),
    fahrzeug_id        INTEGER REFERENCES fahrzeug(id),
    uhs_typ            TEXT CHECK (uhs_typ IS NULL OR uhs_typ IN
        ('patientenablage', 'behandlungsplatz', 'verletztensammelstelle', 'sonstige')),
    sortier            INTEGER NOT NULL DEFAULT 0,
    schichtlaenge_min  INTEGER CHECK (schichtlaenge_min IS NULL
        OR (schichtlaenge_min BETWEEN 10 AND 1440 AND schichtlaenge_min % 5 = 0)),
    soll_anzahl        INTEGER CHECK (soll_anzahl IS NULL OR soll_anzahl BETWEEN 1 AND 200),
    quali_soll         TEXT
        CHECK (quali_soll IS NULL OR (json_valid(quali_soll) AND json_type(quali_soll) = 'array')),
    CHECK (
        (art = 'einheit' AND uhs_typ IS NULL
            AND (einheit_vorlage_id IS NULL OR fahrzeug_id IS NULL))
        OR (art = 'uhs' AND uhs_typ IS NOT NULL
            AND einheit_vorlage_id IS NULL AND fahrzeug_id IS NULL)
    )
);
CREATE UNIQUE INDEX uq_planung_posten_bezeichnung ON planung_posten(planung_id, bezeichnung COLLATE NOCASE);
CREATE INDEX idx_planung_posten_vorlage ON planung_posten(einheit_vorlage_id);
CREATE INDEX idx_planung_posten_fahrzeug ON planung_posten(fahrzeug_id);

CREATE TABLE planung_helfer (
    id              INTEGER PRIMARY KEY,
    planung_id      INTEGER NOT NULL REFERENCES planung(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    telefon         TEXT,
    organisation    TEXT,
    qualifikationen TEXT
        CHECK (qualifikationen IS NULL
            OR (json_valid(qualifikationen) AND json_type(qualifikationen) = 'array')),
    angelegt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    angelegt_von    INTEGER REFERENCES benutzer(id)
);
CREATE INDEX idx_planung_helfer_planung ON planung_helfer(planung_id);

CREATE TABLE planung_schicht (
    id            INTEGER PRIMARY KEY,
    planung_id    INTEGER NOT NULL REFERENCES planung(id) ON DELETE CASCADE,
    posten_id     INTEGER REFERENCES planung_posten(id) ON DELETE CASCADE,
    von           TEXT    NOT NULL,
    bis           TEXT    NOT NULL,
    soll_anzahl   INTEGER CHECK (soll_anzahl IS NULL OR soll_anzahl BETWEEN 1 AND 200),
    quali_soll    TEXT
        CHECK (quali_soll IS NULL OR (json_valid(quali_soll) AND json_type(quali_soll) = 'array')),
    notiz         TEXT,
    version       INTEGER NOT NULL DEFAULT 1,
    angelegt_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    angelegt_von  INTEGER REFERENCES benutzer(id),
    geaendert_at  TEXT,
    geaendert_von INTEGER REFERENCES benutzer(id),
    CHECK (bis > von),
    CHECK (posten_id IS NOT NULL OR (soll_anzahl IS NULL AND quali_soll IS NULL))
);
CREATE INDEX idx_planung_schicht_posten ON planung_schicht(planung_id, posten_id, von);
CREATE INDEX idx_planung_schicht_posten_fk ON planung_schicht(posten_id);

CREATE TABLE planung_schicht_person (
    schicht_id  INTEGER NOT NULL REFERENCES planung_schicht(id) ON DELETE CASCADE,
    personal_id INTEGER REFERENCES personal(id),
    helfer_id   INTEGER REFERENCES planung_helfer(id) ON DELETE CASCADE,
    CHECK ((personal_id IS NOT NULL) + (helfer_id IS NOT NULL) = 1)
);
CREATE UNIQUE INDEX uq_planung_schicht_person_stamm
    ON planung_schicht_person(schicht_id, personal_id) WHERE personal_id IS NOT NULL;
CREATE UNIQUE INDEX uq_planung_schicht_person_helfer
    ON planung_schicht_person(schicht_id, helfer_id) WHERE helfer_id IS NOT NULL;
CREATE INDEX idx_planung_schicht_person_stamm ON planung_schicht_person(personal_id);
CREATE INDEX idx_planung_schicht_person_helfer ON planung_schicht_person(helfer_id);

CREATE TABLE demo_herkunft_neu (
    import_id    INTEGER NOT NULL REFERENCES demo_import(id) ON DELETE CASCADE,
    tabelle      TEXT    NOT NULL CHECK (tabelle IN ('fahrzeug', 'personal', 'material', 'einheit_vorlage', 'schichtmodell', 'planung')),
    datensatz_id INTEGER NOT NULL,
    PRIMARY KEY (tabelle, datensatz_id)
);

INSERT INTO demo_herkunft_neu (import_id, tabelle, datensatz_id)
    SELECT import_id, tabelle, datensatz_id FROM demo_herkunft;

DROP TABLE demo_herkunft;

ALTER TABLE demo_herkunft_neu RENAME TO demo_herkunft;
