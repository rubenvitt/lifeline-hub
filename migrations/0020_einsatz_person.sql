-- Einsatz-scoped Personen-Stamm (Vermisste, Betroffene, Verstorbene, …).
-- Kein globaler Stamm, keine Disposition. Identität optional; die
-- server-vergebene registrier_nr ist die stabile Kennung. Soft-Delete via
-- storniert_at (kein Hard-Delete).
CREATE TABLE einsatz_person (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    registrier_nr   INTEGER NOT NULL,           -- fortlaufend je Einsatz (server-autoritativ)
    status          TEXT    NOT NULL DEFAULT 'erfasst'
                    CHECK (status IN ('erfasst','vermisst','betroffen','verstorben','abgemeldet')),

    -- Identität (alle optional — unbekannte Personen erstklassig)
    name            TEXT,
    vorname         TEXT,
    geschlecht      TEXT CHECK (geschlecht IN ('maennlich','weiblich','divers','unbekannt')),
    geburtsdatum    TEXT,                        -- YYYY-MM-DD, falls bekannt
    alter_geschaetzt INTEGER,                    -- geschätztes Alter in Jahren, falls geburtsdatum NULL
    herkunft_adresse TEXT,

    -- Erfassungskontext
    antreff_ort     TEXT,                        -- Freitext (strukturierte Unfallhilfsstelle → E‑3)
    melder_kontakt  TEXT,                        -- bei vermisst: wer meldet (Angehöriger/Kontakt)
    notiz           TEXT,

    -- Meta / Audit
    erfasst_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von     INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_von   INTEGER NOT NULL REFERENCES benutzer(id),
    storniert_at    TEXT,                        -- Soft-Delete (Fehleingabe); kein Hard-Delete

    UNIQUE (einsatz_id, registrier_nr)
);

CREATE INDEX idx_einsatz_person_einsatz ON einsatz_person (einsatz_id, status);
