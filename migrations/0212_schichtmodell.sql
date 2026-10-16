-- LLH-1122 Teil I (Epic LLH-1016, Entscheidung LLH-1118 Punkte 2, 3, 5 und 7): Schichtmodelle
-- in den Stammdaten, Standardschicht je Einsatz und EIN gemeinsamer Neubau von
-- `einsatz_abloesung` für LLH-1122, LLH-1128, LLH-1132 und LLH-1150.
--
-- 1. `schichtmodell` — Org-Stammdatum. Typ `rhythmus` (fester Rhythmus in Minuten) oder
--    `wechselzeiten` (feste Uhrzeiten als JSON-Liste `["06:00","18:00"]` plus Mindestdauer):
--    fällig ist der erste Wechsel nach Beginn + Mindestdauer, gerechnet in der wirksamen Zone
--    Einsatz → Org → Europe/Berlin (`abloesung::faelligkeit_wechselzeiten`). Vorwarnung
--    (Vorgabe 30 min) und Planungsvorlauf (Vorgabe 120 min, genutzt ab LLH-1131) je Modell.
--    Höchstens eine Vorgabe je Org (Teilindex, die Route meldet 409). Kein Fremdschlüssel aus
--    oder zu einer Einsatztabelle: der Einsatz kopiert (2.), deshalb nicht in der
--    Schwärzungs-Registry (Guard `stammdaten_teilbaum_nie_einsatz_scoped`). AUTOINCREMENT, weil
--    Modelle echt gelöscht werden und `demo_herkunft` polymorph ohne FK auf die id zeigt: eine
--    wiederverwendete id machte ein echtes Modell zum Demo-Modell.
CREATE TABLE schichtmodell (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id                  INTEGER NOT NULL REFERENCES organisation(id),
    bezeichnung             TEXT    NOT NULL,
    typ                     TEXT    NOT NULL CHECK (typ IN ('rhythmus', 'wechselzeiten')),
    rhythmus_minuten        INTEGER
        CHECK (rhythmus_minuten IS NULL OR (rhythmus_minuten > 0 AND rhythmus_minuten <= 10080)),
    wechselzeiten           TEXT
        CHECK (wechselzeiten IS NULL OR (json_valid(wechselzeiten)
               AND json_type(wechselzeiten) = 'array'
               AND json_array_length(wechselzeiten) BETWEEN 1 AND 24)),
    mindestdauer_minuten    INTEGER
        CHECK (mindestdauer_minuten IS NULL
               OR (mindestdauer_minuten >= 0 AND mindestdauer_minuten <= 1440)),
    vorwarnung_minuten      INTEGER NOT NULL DEFAULT 30
        CHECK (vorwarnung_minuten > 0 AND vorwarnung_minuten <= 1440),
    planungsvorlauf_minuten INTEGER NOT NULL DEFAULT 120
        CHECK (planungsvorlauf_minuten > 0 AND planungsvorlauf_minuten <= 1440),
    ist_vorgabe             INTEGER NOT NULL DEFAULT 0 CHECK (ist_vorgabe IN (0, 1)),
    angelegt_at             TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK ((typ = 'rhythmus' AND rhythmus_minuten IS NOT NULL
                AND wechselzeiten IS NULL AND mindestdauer_minuten IS NULL)
        OR (typ = 'wechselzeiten' AND rhythmus_minuten IS NULL
                AND wechselzeiten IS NOT NULL AND mindestdauer_minuten IS NOT NULL))
);

-- Genau eine Vorgabe je Org: das Netz unter der 409-Prüfung des Repos.
CREATE UNIQUE INDEX idx_schichtmodell_vorgabe ON schichtmodell(org_id) WHERE ist_vorgabe = 1;
-- Bezeichnung je Org eindeutig; das Repo vergleicht zusätzlich ohne Groß-/Kleinschreibung.
CREATE UNIQUE INDEX idx_schichtmodell_name ON schichtmodell(org_id, bezeichnung);

-- 2. `einsatz_schichtmodell` — die Kopie am Einsatz (1:1, fehlt = keine Einsatzvorgabe). Eine
--    eigene Tabelle statt Spalten an `einsatz`: sieben Werte, die nur die Ablösung liest, gehören
--    nicht in die zentrale Kopfzeile (Kopf-DTO, Archiv-Projektion, Registry-Spalten von
--    `einsatz`), und „keine Vorgabe“ ist schlicht keine Zeile statt sieben NULL. Bewusst KEIN
--    Verweis auf `schichtmodell`: eine spätere Stammdatenänderung oder das Löschen des Modells
--    verschiebt keine laufende Fälligkeit, und der Demo-Löschweg findet keinen Halter.
CREATE TABLE einsatz_schichtmodell (
    einsatz_id              INTEGER PRIMARY KEY REFERENCES einsatz(id) ON DELETE CASCADE,
    bezeichnung             TEXT    NOT NULL,
    typ                     TEXT    NOT NULL CHECK (typ IN ('rhythmus', 'wechselzeiten')),
    rhythmus_minuten        INTEGER
        CHECK (rhythmus_minuten IS NULL OR (rhythmus_minuten > 0 AND rhythmus_minuten <= 10080)),
    wechselzeiten           TEXT
        CHECK (wechselzeiten IS NULL OR (json_valid(wechselzeiten)
               AND json_type(wechselzeiten) = 'array'
               AND json_array_length(wechselzeiten) BETWEEN 1 AND 24)),
    mindestdauer_minuten    INTEGER
        CHECK (mindestdauer_minuten IS NULL
               OR (mindestdauer_minuten >= 0 AND mindestdauer_minuten <= 1440)),
    vorwarnung_minuten      INTEGER NOT NULL
        CHECK (vorwarnung_minuten > 0 AND vorwarnung_minuten <= 1440),
    planungsvorlauf_minuten INTEGER NOT NULL
        CHECK (planungsvorlauf_minuten > 0 AND planungsvorlauf_minuten <= 1440),
    geaendert_von_id        INTEGER REFERENCES benutzer(id),
    geaendert_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK ((typ = 'rhythmus' AND rhythmus_minuten IS NOT NULL
                AND wechselzeiten IS NULL AND mindestdauer_minuten IS NULL)
        OR (typ = 'wechselzeiten' AND rhythmus_minuten IS NULL
                AND wechselzeiten IS NOT NULL AND mindestdauer_minuten IS NOT NULL))
);

-- 3. Neubau von `einsatz_abloesung` (Schema = 0114 1:1, Index aus 0153). SQLite ändert einen
--    CHECK nur per Neubau; die beiden CHECK-Änderungen tragen den Neubau, alles Weitere kommt
--    vorausschauend mit, damit keiner der Folge-Tasks einen zweiten braucht:
--    - `rhythmus_quelle` + `einsatz` (LLH-1122: Rangfolge eigen → Abschnitt → Einsatz).
--    - `status` + `beendet` (LLH-1128, Entscheidung 15.10.: Auflösen und Entlassung beenden die
--      laufende Schicht mit Spur statt sie zu löschen). Die Spur: `beendet_at`, `beendet_von_id`,
--      `beendet_grund`. Der Grund bewusst OHNE CHECK: ihn setzt nur der Code (Rust-Enum), und ein
--      weiterer Grund soll keinen Neubau verlangen.
--    - `art` `einheit | besatzung` (LLH-1150, Vorgabe `einheit`).
--    - Abschnittsübergabe beim Vollzug (LLH-1132): `abschnitt_uebergeben` sagt, ob der Vollzug
--      Abschnitte umgehängt hat, `abgeloest_abschnitt_vorher_id` den Abschnitt der abgelösten
--      Einheit davor (NULL = sie hatte keinen); die Rücknahme stellt ihn wieder her. Den
--      Vorher-Abschnitt jedes Ablösers trägt `einsatz_abloesung_abloeser` (4.).
--    Weitere nullable Spalten (etwa „Abgelöste Einheit danach“ aus LLH-1132) gehen später per
--    `ADD COLUMN` ohne Neubau.
--
--    Selbstverweis `vorgaenger_id`: die alte Tabelle wird zuerst umbenannt (Muster 0193). So legt
--    der Neubau seinen Selbstbezug unter dem endgültigen Namen an, und das DROP der alten setzt nur
--    deren eigene Zeilen auf NULL. Kein anderer Fremdschlüssel zeigt bis hierher auf die Tabelle
--    (grep über migrations/: nur 0114 und 0153), ohne AUTOINCREMENT, ohne Trigger und Views; die
--    ids werden 1:1 kopiert. Abgesichert von db::tests::migration_0212_*.
ALTER TABLE einsatz_abloesung RENAME TO einsatz_abloesung_alt;

CREATE TABLE einsatz_abloesung (
    id                    INTEGER PRIMARY KEY,
    einsatz_id            INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    einheit_id            INTEGER NOT NULL REFERENCES einsatz_einheit(id) ON DELETE CASCADE,
    -- Einsatzstelle der Schicht als Snapshot (nicht über die Einheit gejoint): eine
    -- Folgeschicht erbt ihn, auch wenn die ablösende Einheit noch anderswo geführt wird.
    abschnitt_id          INTEGER REFERENCES einsatzabschnitt(id) ON DELETE SET NULL,
    beginn_at             TEXT    NOT NULL,
    -- Bei Wechselzeiten die Dauer von Beginn bis Fälligkeit (gerechnet, nicht eingegeben).
    rhythmus_minuten      INTEGER NOT NULL CHECK (rhythmus_minuten > 0 AND rhythmus_minuten <= 10080),
    -- abschnitt = Vorgabe des Abschnitts; einheit = eigener Wert; einsatz = Vorgabe des Einsatzes
    rhythmus_quelle       TEXT    NOT NULL CHECK (rhythmus_quelle IN ('abschnitt','einheit','einsatz')),
    -- Gespeichert; wird nur zusammen mit Beginn und Rhythmus geschrieben.
    faellig_at            TEXT    NOT NULL,
    abloesende_einheit_id INTEGER REFERENCES einsatz_einheit(id) ON DELETE SET NULL,
    status                TEXT    NOT NULL DEFAULT 'laufend'
                          CHECK (status IN ('laufend','abgeloest','beendet')),
    vollzogen_at          TEXT,
    vollzogen_von_id      INTEGER REFERENCES benutzer(id),
    -- Folgeschicht → abgelöste Schicht (Rückweg der Rücknahme)
    vorgaenger_id         INTEGER REFERENCES einsatz_abloesung(id) ON DELETE SET NULL,
    -- ETB-Eintrag des Vollzugs; Bezug der Berichtigung bei Rücknahme
    etb_vollzug_id        INTEGER REFERENCES etb_eintrag(id),
    angelegt_von_id       INTEGER NOT NULL REFERENCES benutzer(id),
    angelegt_at           TEXT    NOT NULL DEFAULT (datetime('now')),
    art                   TEXT    NOT NULL DEFAULT 'einheit' CHECK (art IN ('einheit','besatzung')),
    beendet_at            TEXT,
    beendet_von_id        INTEGER REFERENCES benutzer(id),
    beendet_grund         TEXT,
    abschnitt_uebergeben  INTEGER NOT NULL DEFAULT 0 CHECK (abschnitt_uebergeben IN (0, 1)),
    abgeloest_abschnitt_vorher_id INTEGER REFERENCES einsatzabschnitt(id) ON DELETE SET NULL
);

INSERT INTO einsatz_abloesung
    (id, einsatz_id, einheit_id, abschnitt_id, beginn_at, rhythmus_minuten, rhythmus_quelle,
     faellig_at, abloesende_einheit_id, status, vollzogen_at, vollzogen_von_id, vorgaenger_id,
     etb_vollzug_id, angelegt_von_id, angelegt_at)
    SELECT id, einsatz_id, einheit_id, abschnitt_id, beginn_at, rhythmus_minuten, rhythmus_quelle,
           faellig_at, abloesende_einheit_id, status, vollzogen_at, vollzogen_von_id,
           vorgaenger_id, etb_vollzug_id, angelegt_von_id, angelegt_at
    FROM einsatz_abloesung_alt
    ORDER BY id;

DROP TABLE einsatz_abloesung_alt;

-- Die Indizes aus 0114 und 0153 fielen mit dem DROP; wortgleich neu.
CREATE UNIQUE INDEX idx_abloesung_laufend_je_einheit
    ON einsatz_abloesung(einheit_id) WHERE status = 'laufend';
CREATE INDEX idx_abloesung_einsatz ON einsatz_abloesung(einsatz_id, status, faellig_at);
CREATE INDEX idx_abloesung_vorgaenger
    ON einsatz_abloesung (vorgaenger_id)
    WHERE vorgaenger_id IS NOT NULL;

-- 4. Mehrere Ablöser je Schicht (LLH-1118 Punkt 3): je Zeile eine geplante ablösende Einheit,
--    beim Vollzug (ab LLH-1132, `ABLOESER_MAX = 8`) je Zeile eine Folgeschicht.
--    `abschnitt_vorher_id` hält den Abschnitt des Ablösers vor einer Abschnittsübergabe
--    (Rücknahme, LLH-1132). Bis LLH-1132 schreibt niemand hinein; die bisherige Einzelplanung
--    `einsatz_abloesung.abloesende_einheit_id` bleibt bis dahin die Wahrheit und wird hier nicht
--    gespiegelt (zwei Wahrheiten). Die Reihenfolge ist die der Anlage (rowid).
CREATE TABLE einsatz_abloesung_abloeser (
    abloesung_id        INTEGER NOT NULL REFERENCES einsatz_abloesung(id) ON DELETE CASCADE,
    einheit_id          INTEGER NOT NULL REFERENCES einsatz_einheit(id) ON DELETE CASCADE,
    abschnitt_vorher_id INTEGER REFERENCES einsatzabschnitt(id) ON DELETE SET NULL,
    angelegt_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (abloesung_id, einheit_id)
);
CREATE INDEX idx_abloesung_abloeser_einheit ON einsatz_abloesung_abloeser(einheit_id);

-- 5. Demo-Marke für Schichtmodelle (`src/AGENTS.md`, „Demo-Daten“): `demo_herkunft.tabelle`
--    kennt per CHECK nur vier Arten. `demo_herkunft` ist Blatt (keine Tabelle verweist darauf),
--    das DROP löst keine Kaskade aus. Schema = 0190 1:1, einzige Änderung ist der CHECK
--    (Wire-Werte von `demo::DemoStammdatenArt`). Abgesichert von db::tests::migration_0212_*.
CREATE TABLE demo_herkunft_neu (
    import_id    INTEGER NOT NULL REFERENCES demo_import(id) ON DELETE CASCADE,
    tabelle      TEXT    NOT NULL CHECK (tabelle IN ('fahrzeug', 'personal', 'material', 'einheit_vorlage', 'schichtmodell')),
    datensatz_id INTEGER NOT NULL,
    PRIMARY KEY (tabelle, datensatz_id)
);

INSERT INTO demo_herkunft_neu (import_id, tabelle, datensatz_id)
    SELECT import_id, tabelle, datensatz_id FROM demo_herkunft;

DROP TABLE demo_herkunft;

ALTER TABLE demo_herkunft_neu RENAME TO demo_herkunft;
