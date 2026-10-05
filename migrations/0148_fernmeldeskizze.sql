-- LFH-893: taktische Fernmeldeskizze des S6 (FwDV 100 / DV 810.3 J.1–J.5).
--
-- Die Skizze speichert nur, was es sonst nirgends gibt: Kanäle externer Stellen, Komponenten,
-- Punkt-zu-Punkt-Verbindungen, Bereiche, die verschobene Lage und das Schriftfeld. Zuordnungen von
-- Abschnitt, Einheit und Führungsstelle bleiben in ihren Tabellen (0073, 0145).
--
-- **Polymorphe Bezüge** (`von_art`/`von_id`, `nach_art`/`nach_id`, `element`) haben keinen
-- Fremdschlüssel. Jeder Löschpfad von Abschnitt, Einheit, Kommunikationsstelle und Komponente
-- räumt sie im selben Transaktionsschritt ab (`stab::fernmeldeskizze::vergiss`, Guard-Test dort).
--
-- Herleitung: openspec/changes/archive/2026-10-05-lfh-893-taktische-fernmeldeskizze/design.md (D3, D4, D14).

-- Kanäle externer Stellen am Datensatz des Kommunikationsplans: eine Leitstelle ist eine Stelle,
-- nicht zwei. Eine Funktion (stellenart = 'funktion') trägt keine; das prüft der Code (422).
CREATE TABLE einsatz_kommunikation_stelle_sprechgruppe (
    stelle_id       INTEGER NOT NULL REFERENCES einsatz_kommunikation_stelle(id) ON DELETE CASCADE,
    sprechgruppe_id INTEGER NOT NULL REFERENCES sprechgruppe(id) ON DELETE CASCADE,
    status          TEXT    NOT NULL DEFAULT 'bestehend' CHECK (status IN ('bestehend','geplant')),
    geaendert_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (stelle_id, sprechgruppe_id)
);
CREATE INDEX idx_kommunikation_stelle_sprechgruppe_sg
    ON einsatz_kommunikation_stelle_sprechgruppe(sprechgruppe_id);

CREATE TABLE fernmeldeskizze_komponente (
    id               INTEGER PRIMARY KEY,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    art              TEXT    NOT NULL CHECK (art IN ('repeater','gateway','basisstation',
                                                     'mobile_basisstation','antenne','vermittlung')),
    bezeichnung      TEXT,             -- ≤ 100 Zeichen; Freitext
    geaendert_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_fernmeldeskizze_komponente_einsatz ON fernmeldeskizze_komponente(einsatz_id);

CREATE TABLE fernmeldeskizze_komponente_sprechgruppe (
    komponente_id   INTEGER NOT NULL REFERENCES fernmeldeskizze_komponente(id) ON DELETE CASCADE,
    sprechgruppe_id INTEGER NOT NULL REFERENCES sprechgruppe(id) ON DELETE CASCADE,
    geaendert_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (komponente_id, sprechgruppe_id)
);
CREATE INDEX idx_fernmeldeskizze_komponente_sprechgruppe_sg
    ON fernmeldeskizze_komponente_sprechgruppe(sprechgruppe_id);

-- Punkt-zu-Punkt-Verbindung zwischen zwei Stellen oder Komponenten. Keine Erreichbarkeit: Nummern
-- stehen im Kommunikationsplan. `von_id`/`nach_id` sind NULL genau bei der Führungsstelle (eine
-- je Einsatz); die Zusammenhänge prüft der Code (422).
CREATE TABLE fernmeldeskizze_verbindung (
    id               INTEGER PRIMARY KEY,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    von_art          TEXT    NOT NULL CHECK (von_art IN ('fuehrungsstelle','abschnitt','einheit',
                                                         'stelle','komponente')),
    von_id           INTEGER,
    nach_art         TEXT    NOT NULL CHECK (nach_art IN ('fuehrungsstelle','abschnitt','einheit',
                                                          'stelle','komponente')),
    nach_id          INTEGER,
    art              TEXT    NOT NULL CHECK (art IN ('telefon','fax','daten','melder','bild',
                                                     'livestream','richtfunk','satellit','sonstige')),
    medium           TEXT    NOT NULL CHECK (medium IN ('funk','leitung')),
    status           TEXT    NOT NULL CHECK (status IN ('bestehend','geplant')),
    verkehr          TEXT    CHECK (verkehr IN ('wechsel','gegen')),
    hinweis          TEXT,             -- ≤ 200 Zeichen; Freitext
    geaendert_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_fernmeldeskizze_verbindung_einsatz ON fernmeldeskizze_verbindung(einsatz_id);

-- Bereich (Strich-Punkt-Grenze), z. B. „Rückwärtiger Bereich“. `version` schützt Lage und Größe
-- gegen stilles Überschreiben (409).
CREATE TABLE fernmeldeskizze_bereich (
    id               INTEGER PRIMARY KEY,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    bezeichnung      TEXT    NOT NULL DEFAULT 'Rückwärtiger Bereich', -- ≤ 100 Zeichen
    x                REAL    NOT NULL,
    y                REAL    NOT NULL,
    breite           REAL    NOT NULL CHECK (breite > 0),
    hoehe            REAL    NOT NULL CHECK (hoehe > 0),
    version          INTEGER NOT NULL DEFAULT 1,
    geaendert_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_fernmeldeskizze_bereich_einsatz ON fernmeldeskizze_bereich(einsatz_id);

-- Gespeichert wird nur Verschobenes; ohne Zeile platziert das Auto-Layout des Clients (D4).
-- `element` ∈ 'fs' | 'ab-<id>' | 'eh-<id>' | 'ks-<id>' | 'ko-<id>' | 'sg-<id>'; `breite` nur
-- bei Schienen.
CREATE TABLE fernmeldeskizze_lage (
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    element          TEXT    NOT NULL,
    x                REAL    NOT NULL,
    y                REAL    NOT NULL,
    breite           REAL    CHECK (breite IS NULL OR breite > 0),
    version          INTEGER NOT NULL DEFAULT 1,
    geaendert_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (einsatz_id, element)
);

-- Schriftfeld (J.5), eine Zeile je Einsatz, lazy beim ersten PUT. Fehlt die Zeile oder ist
-- `herausgeber` leer, gilt die Einsatzbezeichnung. `gez_name` ist personenbezogen (Schwärzung).
CREATE TABLE fernmeldeskizze_schriftfeld (
    einsatz_id       INTEGER PRIMARY KEY REFERENCES einsatz(id) ON DELETE CASCADE,
    herausgeber      TEXT,             -- ≤ 200 Zeichen
    vs_vermerk       TEXT    NOT NULL DEFAULT 'keiner' CHECK (vs_vermerk IN ('keiner','vs_nfd')),
    gueltig_ab       TEXT,
    gez_name         TEXT,             -- ≤ 100 Zeichen; PII
    gez_at           TEXT,
    geaendert_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
