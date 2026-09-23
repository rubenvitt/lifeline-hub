-- LFH-639: Fachmodul Betreuung. Zwei Objekte mit je einer append-only Meldereihe:
--   Evakuierungsbezirk (Plangröße, Räumungszustand) ← Standmeldungen „evakuiert“
--   Betreuungsstelle (Art, Kapazität, Status)       ← Belegungsmeldungen „untergebracht“
-- Mengen, keine Personen: es gibt bewusst keinen Bezug zu einsatz_person/person_verbleib.
--
-- Der Cache am Objekt ist ein ZEIGER auf die aktuelle Meldung (stand_id / belegung_id),
-- keine kopierte Zahl. Geschrieben wird er nur in `betreuung::repo`, in derselben
-- Transaktion wie Meldung bzw. Rücknahme, über die eine „aktuell“-Abfrage (design.md D2:
-- nicht zurückgenommen, jüngster zeitpunkt_at, bei Gleichstand größere id).
--
-- `einsatz_id` an den Meldetabellen ist redundant zu bezirk_id/stelle_id → einsatz_id,
-- aber nötig: die Schwärzungs-Registry entdeckt einsatzbezogene Tabellen über
-- `einsatz_id` + CASCADE, und die Kopfzahl-Abfrage filtert direkt darüber.
--
-- Abschnitt wird hart gelöscht → ON DELETE SET NULL (sonst blockiert der FK, LFH-237).
-- Die Einsatzzugehörigkeit des Abschnitts prüft das Repo; der FK sichert sie nicht.
-- Stornieren ist Soft-Delete (Fehlanlage); die Bezeichnung wird danach wieder frei.

CREATE TABLE evakuierungsbezirk (
    id               INTEGER PRIMARY KEY,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    abschnitt_id     INTEGER REFERENCES einsatzabschnitt(id) ON DELETE SET NULL,
    bezeichnung      TEXT    NOT NULL,
    plan_personen    INTEGER NOT NULL CHECK (plan_personen >= 1),
    plan_erhebung    TEXT    NOT NULL CHECK (plan_erhebung IN ('gezaehlt','geschaetzt')),
    raeumung         TEXT    NOT NULL DEFAULT 'angeordnet'
        CHECK (raeumung IN ('angeordnet','laeuft','geraeumt','aufgehoben')),
    sammelstelle     TEXT,
    notiz            TEXT,
    -- Cache: aktuelle Standmeldung (NULL = keine Meldung)
    stand_id         INTEGER REFERENCES evakuierung_stand(id) ON DELETE SET NULL,
    storniert_at     TEXT,
    storniert_von_id INTEGER REFERENCES benutzer(id),
    angelegt_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    angelegt_von_id  INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at     TEXT
);
CREATE UNIQUE INDEX idx_evakuierungsbezirk_bezeichnung
    ON evakuierungsbezirk(einsatz_id, bezeichnung) WHERE storniert_at IS NULL;

-- append-only; eine Rücknahme kennzeichnet die Zeile, statt sie zu löschen.
CREATE TABLE evakuierung_stand (
    id                     INTEGER PRIMARY KEY,
    bezirk_id              INTEGER NOT NULL REFERENCES evakuierungsbezirk(id) ON DELETE CASCADE,
    einsatz_id             INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    evakuiert              INTEGER NOT NULL CHECK (evakuiert >= 0),
    erhebung               TEXT    NOT NULL CHECK (erhebung IN ('gezaehlt','geschaetzt')),
    zeitpunkt_at           TEXT    NOT NULL,
    erfasst_at             TEXT    NOT NULL DEFAULT (datetime('now')),
    erfasst_von_id         INTEGER NOT NULL REFERENCES benutzer(id),
    -- ETB-Eintrag der Meldung; Bezug der Berichtigung bei Rücknahme (einseitig, LFH-635 D6)
    etb_eintrag_id         INTEGER NOT NULL REFERENCES etb_eintrag(id),
    zurueckgenommen_at     TEXT,
    zurueckgenommen_von_id INTEGER REFERENCES benutzer(id)
);
CREATE INDEX idx_evakuierung_stand_bezirk ON evakuierung_stand(bezirk_id, zeitpunkt_at);

CREATE TABLE betreuungsstelle (
    id                  INTEGER PRIMARY KEY,
    einsatz_id          INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    abschnitt_id        INTEGER REFERENCES einsatzabschnitt(id) ON DELETE SET NULL,
    bezeichnung         TEXT    NOT NULL,
    art                 TEXT    NOT NULL
        CHECK (art IN ('anlaufstelle','betreuungsstelle','betreuungsplatz','notunterkunft')),
    kapazitaet_personen INTEGER CHECK (kapazitaet_personen IS NULL OR kapazitaet_personen >= 1),
    status              TEXT    NOT NULL DEFAULT 'vorbereitet'
        CHECK (status IN ('vorbereitet','in_betrieb','geschlossen')),
    standort            TEXT,
    notiz               TEXT,
    -- Cache: aktuelle Belegungsmeldung (NULL = keine Meldung)
    belegung_id         INTEGER REFERENCES betreuungsstelle_belegung(id) ON DELETE SET NULL,
    storniert_at        TEXT,
    storniert_von_id    INTEGER REFERENCES benutzer(id),
    angelegt_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    angelegt_von_id     INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at        TEXT
);
CREATE UNIQUE INDEX idx_betreuungsstelle_bezeichnung
    ON betreuungsstelle(einsatz_id, bezeichnung) WHERE storniert_at IS NULL;

-- append-only, Rumpf wie evakuierung_stand.
CREATE TABLE betreuungsstelle_belegung (
    id                     INTEGER PRIMARY KEY,
    stelle_id              INTEGER NOT NULL REFERENCES betreuungsstelle(id) ON DELETE CASCADE,
    einsatz_id             INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    belegt                 INTEGER NOT NULL CHECK (belegt >= 0),
    zeitpunkt_at           TEXT    NOT NULL,
    erfasst_at             TEXT    NOT NULL DEFAULT (datetime('now')),
    erfasst_von_id         INTEGER NOT NULL REFERENCES benutzer(id),
    etb_eintrag_id         INTEGER NOT NULL REFERENCES etb_eintrag(id),
    zurueckgenommen_at     TEXT,
    zurueckgenommen_von_id INTEGER REFERENCES benutzer(id)
);
CREATE INDEX idx_betreuungsstelle_belegung_stelle
    ON betreuungsstelle_belegung(stelle_id, zeitpunkt_at);
