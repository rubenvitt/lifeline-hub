-- LLH-1324: Maßnahmen am Patienten mit festem Katalog und Uhrzeit (Change y18v58dt-pat-kern,
-- Spec `personen-massnahmen`, design.md D1/D5).
--
-- Nur anhängend: eine Maßnahme wird nie geändert oder gelöscht, nur genau einmal aufgehoben.
-- `aufgehoben_at`/`aufgehoben_von_id` stehen an der Zeile und werden mit einem bedingten UPDATE
-- (`… AND aufgehoben_at IS NULL`) gesetzt; ein zweites, auch ein gleichzeitiges Aufheben trifft
-- keine Zeile mehr (409, Muster `src/storno.rs`, `migrations/0180_auftrag_aufhebung.sql`). Einen
-- Grund nimmt das Aufheben nicht an, also entsteht keine weitere Scrub-Spalte.
--
-- `zeitpunkt_at` ist die Durchführung (ohne Angabe die Erfassung, gekappt über
-- `support::erfassungszeitpunkt`), `erfasst_at` die Ankunft beim Server. Beide setzt der INSERT.
-- „Bestätigt von“ am UHS-Gerät wie 0165, `client_id` je Einsatz eindeutig wie 0217/0219.
CREATE TABLE person_massnahme (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id              INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id               INTEGER NOT NULL REFERENCES einsatz_person(id),
    art                     TEXT    NOT NULL CHECK (art IN ('blutstillung', 'zugang', 'infusion',
                                'sauerstoff', 'atemweg', 'analgesie', 'immobilisation',
                                'waermeerhalt', 'dekontamination')),
    zeitpunkt_at            TEXT    NOT NULL,
    erfasst_at              TEXT    NOT NULL,
    erfasst_von             INTEGER NOT NULL REFERENCES benutzer(id),
    bestaetigt_personal_id  INTEGER REFERENCES einsatz_personal(id) ON DELETE SET NULL,
    bestaetigt_name         TEXT,
    aufgehoben_at           TEXT,
    aufgehoben_von_id       INTEGER REFERENCES benutzer(id),
    client_id               TEXT
);
CREATE INDEX idx_person_massnahme_person ON person_massnahme (person_id, zeitpunkt_at);
CREATE UNIQUE INDEX idx_person_massnahme_client_id
    ON person_massnahme(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;
