-- LLH-1572: vier häufige Maßnahmen des Sanitätsdienstes im festen Katalog (Change
-- `o1igsr0s-leichte-faelle`, design.md D8, Spec `personen-massnahmen`): `wundversorgung`,
-- `kuehlung`, `lagerung`, `betreuung_gespraech`, hinten an die Katalogfolge. Die Regeln aus 0220
-- bleiben: anhängend, genau einmal aufhebbar, `client_id` je Einsatz eindeutig.
--
-- SQLite ändert einen Tabellen-CHECK nur per Rebuild. `person_massnahme` ist ein Blatt: keine
-- Tabelle verweist auf sie, also löscht das DROP über keine Kaskade etwas mit (anders als 0286).
-- Die ids bleiben 1:1, die AUTOINCREMENT-Sequenz zieht mit (Muster 0112/0222): sonst vergäbe
-- SQLite die id einer gelöschten höchsten Zeile erneut. Schema = 0220 1:1 plus die vier Werte im
-- CHECK.
-- Abgesichert von db::tests::migration_0295_person_massnahme_sanitaetsdienst.

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

-- Sequenz der Alt-Tabelle übernehmen, bevor DROP ihren Eintrag entfernt (Begründung in 0112).
DELETE FROM sqlite_sequence
 WHERE name = 'person_massnahme_neu'
   AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'person_massnahme');
INSERT INTO sqlite_sequence (name, seq)
    SELECT 'person_massnahme_neu', seq FROM sqlite_sequence WHERE name = 'person_massnahme';

DROP TABLE person_massnahme;

ALTER TABLE person_massnahme_neu RENAME TO person_massnahme;

-- No-op, falls SQLite den Eintrag beim RENAME bereits mitzieht (wie in 0082).
UPDATE sqlite_sequence SET name = 'person_massnahme' WHERE name = 'person_massnahme_neu';

CREATE INDEX idx_person_massnahme_person ON person_massnahme (person_id, zeitpunkt_at);
CREATE UNIQUE INDEX idx_person_massnahme_client_id
    ON person_massnahme(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;
