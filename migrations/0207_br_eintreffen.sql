-- LLH-1075: Eintreffende Kräfte am Bereitstellungsraum einbuchen, auch unangemeldete, mit Meldung
-- an die Führung (Change i76r8inr-eintreffende-kraefte-br-einbuchen, design.md D3, D4, D8).
--
-- 1. Kennzeichen „nicht übernommen“ an der Einheit (D3). `uebernahme_offen_seit` setzt das
--    unangemeldete Eintreffen auf den Erfassungszeitpunkt; es bleibt nach der Übernahme stehen
--    und ist zugleich die Herkunft „unangemeldet“. Offen heißt `uebernahme_offen_seit IS NOT NULL
--    AND uebernommen_at IS NULL AND aufgeloest_at IS NULL`; abgewiesen ist eine aufgelöste
--    Einheit ohne `uebernommen_at`. `uebernahme_meldung_id` ist die Meldung des Eintreffens, die
--    Übernehmen und Abweisen bestätigen. Kein Zeitpunkt der Zeitachse: keine Dauer und keine
--    Periode rechnet damit (`frontend/src/kraefte/AGENTS.md`). Invarianten im Code, keine CHECKs.
ALTER TABLE einsatz_einheit ADD COLUMN uebernahme_offen_seit TEXT;
ALTER TABLE einsatz_einheit ADD COLUMN uebernommen_at TEXT;
ALTER TABLE einsatz_einheit ADD COLUMN uebernommen_von INTEGER REFERENCES benutzer(id);
ALTER TABLE einsatz_einheit ADD COLUMN uebernahme_meldung_id INTEGER
    REFERENCES meldung(id) ON DELETE SET NULL;

-- 2. Idempotenz des Eintreffens (D8, Muster 0122): jedes Eintreffen schreibt genau eine
--    Belegungszeile, die trägt den Schlüssel der Offline-Warteschlange. Eindeutig je Einsatz;
--    NULL bleibt für Belegungen ohne Schlüssel (Seitenleiste, Abweisen, Altbestand) erlaubt.
--    LLH-1085 baut `br_belegung` neu und muss Spalte und Index mitnehmen
--    (Guard db::tests::migration_0207_br_belegung_client_id).
ALTER TABLE br_belegung ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX idx_br_belegung_client_id
    ON br_belegung(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;

-- 3. Neubau der Zeitachse (D4, Muster 0193): die Quelle `bereitstellungsraum` kennzeichnet das
--    Eintreffen, das der Bereitstellungsraum bucht. Die Tabelle ist weiter ein Blatt (nur der
--    Selbstbezug `ursprung_id`; `grep -l einsatz_kraft_zeitachse migrations/*.sql`: 0130, 0193),
--    ohne AUTOINCREMENT, Trigger und Views. Schema = 0193 1:1, geändert ist nur der CHECK auf
--    `quelle`. Abgesichert von db::tests::migration_0207_* und zeitachse::repo::tests.
ALTER TABLE einsatz_kraft_zeitachse RENAME TO einsatz_kraft_zeitachse_alt;

CREATE TABLE einsatz_kraft_zeitachse (
    id             INTEGER PRIMARY KEY,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    einheit_id     INTEGER REFERENCES einsatz_einheit(id),
    personal_id    INTEGER REFERENCES einsatz_personal(id),
    art            TEXT    NOT NULL
                   CHECK (art IN ('alarmierung', 'eintreffen', 'abloesung', 'entlassung')),
    zeitpunkt_at   TEXT    NOT NULL,
    -- status = aus einem markierten Statuswechsel; einheit = Fan-out von der Einheit;
    -- abloesung = aus dem Vollzug einer Ablösung (LFH-635); nachtrag = von Hand;
    -- disposition = aus dem Entlassen einer Kraft (LLH-1079);
    -- bereitstellungsraum = Eintreffen am Bereitstellungsraum gebucht (LLH-1075)
    quelle         TEXT    NOT NULL
                   CHECK (quelle IN ('status', 'einheit', 'abloesung', 'nachtrag', 'disposition',
                                     'bereitstellungsraum')),
    -- Fan-out: das Einheit-Ereignis, aus dem dieses Personen-Ereignis entstand.
    ursprung_id    INTEGER REFERENCES einsatz_kraft_zeitachse(id) ON DELETE SET NULL,
    notiz          TEXT,
    erfasst_von    INTEGER NOT NULL REFERENCES benutzer(id),
    erfasst_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    gestrichen_at  TEXT,
    gestrichen_von INTEGER REFERENCES benutzer(id),
    streichgrund   TEXT,
    CHECK ((einheit_id IS NULL) <> (personal_id IS NULL)),
    CHECK ((gestrichen_at IS NULL) = (streichgrund IS NULL))
);

INSERT INTO einsatz_kraft_zeitachse
    (id, einsatz_id, einheit_id, personal_id, art, zeitpunkt_at, quelle, ursprung_id, notiz,
     erfasst_von, erfasst_at, gestrichen_at, gestrichen_von, streichgrund)
    SELECT id, einsatz_id, einheit_id, personal_id, art, zeitpunkt_at, quelle, ursprung_id, notiz,
           erfasst_von, erfasst_at, gestrichen_at, gestrichen_von, streichgrund
    FROM einsatz_kraft_zeitachse_alt
    ORDER BY id;

DROP TABLE einsatz_kraft_zeitachse_alt;

CREATE INDEX idx_zeitachse_einheit ON einsatz_kraft_zeitachse(einheit_id, zeitpunkt_at);
CREATE INDEX idx_zeitachse_personal ON einsatz_kraft_zeitachse(personal_id, zeitpunkt_at);
CREATE INDEX idx_zeitachse_einsatz ON einsatz_kraft_zeitachse(einsatz_id);
CREATE INDEX idx_zeitachse_ursprung ON einsatz_kraft_zeitachse(ursprung_id);
