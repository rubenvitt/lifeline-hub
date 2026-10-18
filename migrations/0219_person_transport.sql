-- LLH-1325: Transportpriorität, -art und benötigte Fachrichtung einer Person als Verlauf mit
-- aktuellem Stand (Change y18v58dt-pat-kern, design.md D2, Spec `personen-transport`).
--
-- `person_transport` ist anhängend (kein UPDATE, kein DELETE). Jede Zeile ist ein VOLLER Stand:
-- jedes der drei Felder darf einzeln leer sein, eine Zeile mit drei NULL hebt den Transport auf.
-- `zeitpunkt_at` ist die Erfassungszeit (ohne Netz die Zeit am Gerät, gekappt über
-- `support::erfassungszeitpunkt`), `erfasst_at` die Ankunft beim Server. Wie bei 0217 setzt der
-- INSERT beide Werte; Vorgabewerte gibt es nicht, damit kein Schreibweg sie still vergisst.
--
-- „Bestätigt von“ am UHS-Gerät wie 0165: Kennung und Namensschnappschuss, ohne CHECK „beide oder
-- keins“ (die Schwärzung setzt den Namen allein auf NULL).
--
-- `client_id` ist je Einsatz eindeutig, nicht je Person (Muster 0098/0122/0217): nur so fällt ein
-- Schlüssel auf, der an einer anderen Person schon vergeben ist.
CREATE TABLE person_transport (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id              INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id               INTEGER NOT NULL REFERENCES einsatz_person(id),
    prioritaet              TEXT CHECK (prioritaet IN ('sofort', 'dringlich', 'normal')),
    art                     TEXT CHECK (art IN ('liegend', 'sitzend', 'mit_notarzt')),
    fachrichtung            TEXT CHECK (fachrichtung IN ('unfallchirurgie', 'verbrennung',
                                'kinder', 'neuro', 'innere', 'geburtshilfe', 'psychiatrie',
                                'sonstige')),
    zeitpunkt_at            TEXT    NOT NULL,
    erfasst_at              TEXT    NOT NULL,
    erfasst_von             INTEGER NOT NULL REFERENCES benutzer(id),
    bestaetigt_personal_id  INTEGER REFERENCES einsatz_personal(id) ON DELETE SET NULL,
    bestaetigt_name         TEXT,
    client_id               TEXT
);
CREATE INDEX idx_person_transport_person ON person_transport (person_id, zeitpunkt_at);
CREATE UNIQUE INDEX idx_person_transport_client_id
    ON person_transport(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;

-- Cache des jüngsten Stands (design.md D6: jüngste Erfassungszeit gewinnt, nicht die Einfügung).
-- `transport_at` ist dessen Erfassungszeit, NULL ohne Transportstand oder nach dem Aufheben.
-- Rein additiv per ADD COLUMN, alle nullable, kein Backfill.
ALTER TABLE einsatz_person ADD COLUMN transport_prioritaet TEXT
    CHECK (transport_prioritaet IN ('sofort', 'dringlich', 'normal'));
ALTER TABLE einsatz_person ADD COLUMN transport_art TEXT
    CHECK (transport_art IN ('liegend', 'sitzend', 'mit_notarzt'));
ALTER TABLE einsatz_person ADD COLUMN transport_fachrichtung TEXT
    CHECK (transport_fachrichtung IN ('unfallchirurgie', 'verbrennung', 'kinder', 'neuro',
        'innere', 'geburtshilfe', 'psychiatrie', 'sonstige'));
ALTER TABLE einsatz_person ADD COLUMN transport_at TEXT;
