-- LFH-634: Fachmodul Verpflegung. Zeitfenster mit erfasstem Bedarf in Essensportionen (EP)
-- und append-only Ausgaben dagegen. Mengen, keine Personen: Sonderkost ist eine Anzahl je
-- Kostform ohne Personenbezug (design.md D1).
--
-- Sonderkost steht als fünf feste Spalten da, nicht als Kindtabelle: der Satz der Kostformen
-- ist fest, und die Teilmengenregel „Σ Sonderkost ≤ Gesamtbedarf bzw. Menge“ wird so zu
-- EINEM CHECK. Der Handler prüft vorab (422 mit eigener Meldung); der CHECK ist das Netz und
-- kommt über LFH-245 ebenfalls als 422 heraus.
--
-- Die Zeitregel `bis_at > von_at` steht bewusst NICHT hier: die Zeitpunkte sind TEXT, und ein
-- Textvergleich trägt nur bei gleich normalisiertem Format. Das Repo parst beide Werte ohnehin
-- und antwortet mit 422.
--
-- `einsatz_id` an der Ausgabe ist redundant zu zeitfenster_id → einsatz_id, aber nötig: die
-- Schwärzungs-Registry entdeckt einsatzbezogene Tabellen über `einsatz_id` + CASCADE, und das
-- Laden je Einsatz braucht keinen Join (Muster `0117_betreuung.sql`).
--
-- Die Nachforderung wird heute nicht gelöscht; falls doch, bleibt die Ausgabe ohne Verweis
-- stehen (SET NULL). Die Einsatzzugehörigkeit des Verweises prüft die Route; der FK sichert
-- sie nicht.

CREATE TABLE verpflegung_zeitfenster (
    id                     INTEGER PRIMARY KEY,
    einsatz_id             INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    bezeichnung            TEXT    NOT NULL,
    von_at                 TEXT    NOT NULL,
    bis_at                 TEXT    NOT NULL,
    bedarf_kraefte         INTEGER NOT NULL CHECK (bedarf_kraefte >= 0),
    bedarf_betreute        INTEGER NOT NULL CHECK (bedarf_betreute >= 0),
    bedarf_weitere         INTEGER NOT NULL DEFAULT 0 CHECK (bedarf_weitere >= 0),
    sk_vegetarisch         INTEGER NOT NULL DEFAULT 0 CHECK (sk_vegetarisch >= 0),
    sk_vegan               INTEGER NOT NULL DEFAULT 0 CHECK (sk_vegan >= 0),
    sk_ohne_schwein        INTEGER NOT NULL DEFAULT 0 CHECK (sk_ohne_schwein >= 0),
    sk_diaet_allergenarm   INTEGER NOT NULL DEFAULT 0 CHECK (sk_diaet_allergenarm >= 0),
    sk_saeugling_kleinkind INTEGER NOT NULL DEFAULT 0 CHECK (sk_saeugling_kleinkind >= 0),
    angelegt_von_id        INTEGER NOT NULL REFERENCES benutzer(id),
    angelegt_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    geaendert_at           TEXT,
    -- Sonderkost ist eine Teilmenge des Gesamtbedarfs, kein Zuschlag.
    CHECK (sk_vegetarisch + sk_vegan + sk_ohne_schwein + sk_diaet_allergenarm
           + sk_saeugling_kleinkind <= bedarf_kraefte + bedarf_betreute + bedarf_weitere)
);
CREATE INDEX idx_verpflegung_zeitfenster_einsatz
    ON verpflegung_zeitfenster(einsatz_id, von_at);

-- append-only; eine Rücknahme kennzeichnet die Zeile, statt sie zu löschen.
CREATE TABLE verpflegung_ausgabe (
    id                     INTEGER PRIMARY KEY,
    einsatz_id             INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    zeitfenster_id         INTEGER NOT NULL
        REFERENCES verpflegung_zeitfenster(id) ON DELETE CASCADE,
    zeitpunkt_at           TEXT    NOT NULL,
    menge                  INTEGER NOT NULL CHECK (menge > 0),
    ort                    TEXT,
    bemerkung              TEXT,
    sk_vegetarisch         INTEGER NOT NULL DEFAULT 0 CHECK (sk_vegetarisch >= 0),
    sk_vegan               INTEGER NOT NULL DEFAULT 0 CHECK (sk_vegan >= 0),
    sk_ohne_schwein        INTEGER NOT NULL DEFAULT 0 CHECK (sk_ohne_schwein >= 0),
    sk_diaet_allergenarm   INTEGER NOT NULL DEFAULT 0 CHECK (sk_diaet_allergenarm >= 0),
    sk_saeugling_kleinkind INTEGER NOT NULL DEFAULT 0 CHECK (sk_saeugling_kleinkind >= 0),
    nachforderung_id       INTEGER REFERENCES nachforderung(id) ON DELETE SET NULL,
    zurueckgenommen_at     TEXT,
    zurueckgenommen_von_id INTEGER REFERENCES benutzer(id),
    erfasst_von_id         INTEGER NOT NULL REFERENCES benutzer(id),
    erfasst_at             TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (sk_vegetarisch + sk_vegan + sk_ohne_schwein + sk_diaet_allergenarm
           + sk_saeugling_kleinkind <= menge)
);
CREATE INDEX idx_verpflegung_ausgabe_zeitfenster ON verpflegung_ausgabe(zeitfenster_id);
