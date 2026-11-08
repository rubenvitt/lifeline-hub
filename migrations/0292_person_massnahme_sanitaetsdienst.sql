-- LLH-1572: vier häufige Maßnahmen des Sanitätsdienstes im festen Katalog (Change
-- `o1igsr0s-leichte-faelle`, design.md D8, Spec `personen-massnahmen`): `wundversorgung`,
-- `kuehlung`, `lagerung`, `betreuung_gespraech`, hinten an die Katalogfolge. Die Regeln aus 0220
-- bleiben: anhängend, genau einmal aufhebbar, `client_id` je Einsatz eindeutig.
--
-- SQLite ändert einen Tabellen-CHECK nur per Rebuild. `person_massnahme` ist ein Blatt: keine
-- Tabelle verweist auf sie, also löscht das DROP über keine Kaskade etwas mit (anders als 0286).
-- Die ids bleiben 1:1. Schema = 0220 1:1 plus die vier Werte im CHECK.
-- Abgesichert von db::tests::migration_0292_person_massnahme_sanitaetsdienst.

CREATE TABLE person_massnahme_neu (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id              INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id               INTEGER NOT NULL REFERENCES einsatz_person(id),
    art                     TEXT    NOT NULL CHECK (art IN ('blutstillung', 'zugang', 'infusion',
                                'sauerstoff', 'atemweg', 'analgesie', 'immobilisation',
                                'waermeerhalt', 'dekontamination', 'wundversorgung',
                                'kuehlung', 'lagerung', 'betreuung_gespraech')),
    zeitpunkt_at            TEXT    NOT NULL,
    erfasst_at              TEXT    NOT NULL,
    erfasst_von             INTEGER NOT NULL REFERENCES benutzer(id),
    bestaetigt_personal_id  INTEGER REFERENCES einsatz_personal(id) ON DELETE SET NULL,
    bestaetigt_name         TEXT,
    aufgehoben_at           TEXT,
    aufgehoben_von_id       INTEGER REFERENCES benutzer(id),
    client_id               TEXT
);

INSERT INTO person_massnahme_neu
    (id, einsatz_id, person_id, art, zeitpunkt_at, erfasst_at, erfasst_von,
     bestaetigt_personal_id, bestaetigt_name, aufgehoben_at, aufgehoben_von_id, client_id)
    SELECT id, einsatz_id, person_id, art, zeitpunkt_at, erfasst_at, erfasst_von,
           bestaetigt_personal_id, bestaetigt_name, aufgehoben_at, aufgehoben_von_id, client_id
    FROM person_massnahme;

DROP TABLE person_massnahme;

ALTER TABLE person_massnahme_neu RENAME TO person_massnahme;

CREATE INDEX idx_person_massnahme_person ON person_massnahme (person_id, zeitpunkt_at);
CREATE UNIQUE INDEX idx_person_massnahme_client_id
    ON person_massnahme(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;
