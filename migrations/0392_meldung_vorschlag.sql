-- LLH-2112: Vorschläge von Fremdsystemen für das Meldungseingang (Design-Doc
-- docs/superpowers/specs/2026-11-28-jd4jgna4-maschinen-eingang-meldungen-design.md,
-- „Tabelle `meldung_vorschlag`“ und „Herkunft an der Meldung“).
--
-- Ein Maschinenzugang mit `meldungen:write` legt einen kurzen Text als unbestätigten Vorschlag ab;
-- ein Mensch übernimmt ihn als Meldung oder verwirft ihn. „Abgelaufen“ ist kein gespeicherter
-- Zustand: das Lesen bestimmt ihn (älter als 12 Stunden, Einsatz nicht aktiv oder Spiegel).
-- Die Tabelle gilt an der Instanz des Zugangs und wird nicht gespiegelt
-- (`instanz::spiegel::art::AUSGENOMMEN`); die übernommene Meldung wird wie jede Meldung gespiegelt.

CREATE TABLE meldung_vorschlag (
    id               INTEGER PRIMARY KEY,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    zugang_id        TEXT REFERENCES maschinenzugang(id) ON DELETE SET NULL,
    external_id      TEXT NOT NULL,
    -- NULL, sobald der Vorschlag übernommen ist: der Wortlaut steht dann in der Meldung.
    text             TEXT,
    adapter          TEXT NOT NULL,
    absender_kennung TEXT NOT NULL,
    absender_name    TEXT,
    signiert         INTEGER NOT NULL CHECK (signiert IN (0, 1)),
    gesendet_at      TEXT,
    empfangen_at     TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'offen'
                     CHECK (status IN ('offen', 'angenommen', 'verworfen')),
    erledigt_at      TEXT,
    erledigt_von_id  INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    meldung_id       INTEGER REFERENCES meldung(id) ON DELETE SET NULL,
    UNIQUE (zugang_id, external_id)
);
CREATE INDEX idx_meldung_vorschlag_einsatz ON meldung_vorschlag (einsatz_id, status, empfangen_at);

-- Herkunft der Meldung, gesetzt nur bei einer Übernahme; ändert sich nie.
ALTER TABLE meldung ADD COLUMN herkunft_adapter TEXT;
ALTER TABLE meldung ADD COLUMN herkunft_kennung TEXT;
ALTER TABLE meldung ADD COLUMN herkunft_name TEXT;
ALTER TABLE meldung ADD COLUMN herkunft_signiert INTEGER;
