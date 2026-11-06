-- LLH-1566: Anlass der Hilfeleistung an der Person als Verlauf mit aktuellem Stand (Konzept
-- LLH-1562, Abschnitt 5.1; Muster `0219_person_transport.sql`).
--
-- `person_anlass` ist anhängend (kein UPDATE, kein DELETE). Jede Zeile ist ein voller Stand; ein
-- leerer `anlass` hebt ihn auf. `zeitpunkt_at` ist die Erfassungszeit (ohne Netz die Zeit am
-- Gerät, gekappt über `support::erfassungszeitpunkt`), `erfasst_at` die Ankunft beim Server.
-- Wie bei 0219 setzt der INSERT beide Werte; Vorgabewerte gibt es nicht.
--
-- Der Katalog ist fest (LLH-1109): ein Gesundheitsdatum der Kategorie „Behandlung“, nie im ETB.
-- `client_id` ist je Einsatz eindeutig, nicht je Person (Muster 0098/0122/0217/0219).
CREATE TABLE person_anlass (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id       INTEGER NOT NULL REFERENCES einsatz_person(id),
    anlass          TEXT CHECK (anlass IN ('verletzung', 'internistisch', 'neurologisch',
                        'intoxikation', 'hitze_kaelte', 'allergie', 'psychisch', 'sonstiges')),
    zeitpunkt_at    TEXT    NOT NULL,
    erfasst_at      TEXT    NOT NULL,
    erfasst_von     INTEGER NOT NULL REFERENCES benutzer(id),
    client_id       TEXT
);
CREATE INDEX idx_person_anlass_person ON person_anlass (person_id, zeitpunkt_at);
CREATE UNIQUE INDEX idx_person_anlass_client_id
    ON person_anlass(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;

-- Cache des jüngsten Stands (jüngste Erfassungszeit gewinnt, nicht die Einfügung). `anlass_at`
-- ist dessen Erfassungszeit, NULL ohne Anlass oder nach dem Aufheben. Rein additiv, kein Backfill.
ALTER TABLE einsatz_person ADD COLUMN anlass TEXT
    CHECK (anlass IN ('verletzung', 'internistisch', 'neurologisch', 'intoxikation',
        'hitze_kaelte', 'allergie', 'psychisch', 'sonstiges'));
ALTER TABLE einsatz_person ADD COLUMN anlass_at TEXT;
