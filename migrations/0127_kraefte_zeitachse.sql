-- LFH-552: Kräfte-Zeitachse. Eine Zeile = ein Ereignis (Alarmierung, Eintreffen, Ablösung,
-- Entlassung) einer Einheit ODER einer Person im Einsatz. Append-only wie br_belegung und
-- etb_eintrag: das Repo schreibt außer der Streichung (die drei gestrichen_*-Spalten, einmalig)
-- kein UPDATE und kein DELETE; ein DELETE entsteht nur über die Kaskade. Kein Trigger, sonst
-- käme die Schwärzung nicht an notiz/streichgrund. Einsatzperioden, Einsatzdauer und Ruhezeit
-- werden beim Lesen abgeleitet, nicht gespeichert.
--
-- Zwei Fremdschlüssel statt polymorph (anders als br_belegung): die Kaskade beim Entfernen
-- einer Kraft trägt die DB, nicht ein Code-Guard.
CREATE TABLE einsatz_kraft_zeitachse (
    id             INTEGER PRIMARY KEY,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    einheit_id     INTEGER REFERENCES einsatz_einheit(id) ON DELETE CASCADE,
    personal_id    INTEGER REFERENCES einsatz_personal(id) ON DELETE CASCADE,
    art            TEXT    NOT NULL
                   CHECK (art IN ('alarmierung', 'eintreffen', 'abloesung', 'entlassung')),
    zeitpunkt_at   TEXT    NOT NULL,
    -- status = aus einem markierten Statuswechsel; einheit = Fan-out von der Einheit;
    -- abloesung = aus dem Vollzug einer Ablösung (LFH-635); nachtrag = von Hand
    quelle         TEXT    NOT NULL
                   CHECK (quelle IN ('status', 'einheit', 'abloesung', 'nachtrag')),
    -- Fan-out: das Einheit-Ereignis, aus dem dieses Personen-Ereignis entstand. SET NULL: wird
    -- die Einheit aufgelöst, bleibt die Zeitachse ihrer Personen stehen.
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
CREATE INDEX idx_zeitachse_einheit ON einsatz_kraft_zeitachse(einheit_id, zeitpunkt_at);
CREATE INDEX idx_zeitachse_personal ON einsatz_kraft_zeitachse(personal_id, zeitpunkt_at);
CREATE INDEX idx_zeitachse_einsatz ON einsatz_kraft_zeitachse(einsatz_id);
CREATE INDEX idx_zeitachse_ursprung ON einsatz_kraft_zeitachse(ursprung_id);

-- Zeitachsen-Marke je Status-Katalogeintrag: ein Wechsel auf diesen Status schreibt das
-- Ereignis. Bestand bleibt NULL — die Labels sind frei, ein Schluss daraus wäre erfunden.
ALTER TABLE fahrzeug_status ADD COLUMN zeitachse_marke TEXT
    CHECK (zeitachse_marke IS NULL OR zeitachse_marke IN ('alarmierung', 'eintreffen', 'entlassung'));
ALTER TABLE personal_status ADD COLUMN zeitachse_marke TEXT
    CHECK (zeitachse_marke IS NULL OR zeitachse_marke IN ('alarmierung', 'eintreffen', 'entlassung'));
