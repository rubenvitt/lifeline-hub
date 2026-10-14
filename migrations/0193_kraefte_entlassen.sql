-- LLH-1079: Kräfte aus dem Einsatz entlassen statt löschen (Change k0s07wsn-kraefte-entlassen,
-- design.md D1/D2).
--
-- 1. Lebenszustand je Dispositionszeile: aktiv heißt `beendet_at IS NULL`. `beendet_als` sagt,
--    wie die Kraft ging: `entlassen` (Normalweg, bleibt im Nachweis) oder `storniert`
--    (Fehldisposition, in keinem Nachweis). Fahrzeug und Material bekommen die Spalten schon
--    jetzt; ihre Wege folgen im zweiten Teil der Change. Eine Einheit wird aufgelöst, nicht
--    entlassen, und kennt keinen Storno als Zustand (sie wird dann echt gelöscht).
--    Das sind Zustände der Zeile, keine Zeitpunkte der Zeitachse: Dauer und Perioden rechnen
--    weiter nur aus `einsatz_kraft_zeitachse` (`frontend/src/kraefte/AGENTS.md`).
ALTER TABLE einsatz_personal ADD COLUMN beendet_at TEXT;
ALTER TABLE einsatz_personal ADD COLUMN beendet_von INTEGER REFERENCES benutzer(id);
ALTER TABLE einsatz_personal ADD COLUMN beendet_als TEXT
    CHECK (beendet_als IS NULL OR beendet_als IN ('entlassen', 'storniert'));
-- Die letzte Entlassung bleibt über das erneute Disponieren hinaus stehen: wer einmal entlassen
-- war, war im Einsatz und lässt sich nicht mehr stornieren (design.md D3), auch wenn seine
-- Zeitachse leer blieb und das erneute Disponieren die Storno-Frist neu beginnen ließe.
ALTER TABLE einsatz_personal ADD COLUMN zuletzt_entlassen_at TEXT;

ALTER TABLE einsatz_fahrzeug ADD COLUMN beendet_at TEXT;
ALTER TABLE einsatz_fahrzeug ADD COLUMN beendet_von INTEGER REFERENCES benutzer(id);
ALTER TABLE einsatz_fahrzeug ADD COLUMN beendet_als TEXT
    CHECK (beendet_als IS NULL OR beendet_als IN ('entlassen', 'storniert'));

ALTER TABLE einsatz_material ADD COLUMN beendet_at TEXT;
ALTER TABLE einsatz_material ADD COLUMN beendet_von INTEGER REFERENCES benutzer(id);
ALTER TABLE einsatz_material ADD COLUMN beendet_als TEXT
    CHECK (beendet_als IS NULL OR beendet_als IN ('entlassen', 'storniert'));

ALTER TABLE einsatz_einheit ADD COLUMN aufgeloest_at TEXT;
ALTER TABLE einsatz_einheit ADD COLUMN aufgeloest_von INTEGER REFERENCES benutzer(id);

-- 2. Neubau der Zeitachse (D1): `einheit_id` und `personal_id` verweisen ohne `ON DELETE`
--    (NO ACTION, geprüft am Ende der Anweisung). Eine Person oder Einheit mit Ereignissen lässt
--    sich damit nicht mehr löschen; das Löschen des ganzen Einsatzes (Aufbewahrung,
--    Demo-Daten) nimmt Kräfte und Zeitachse in derselben Anweisung mit und läuft durch. Die
--    Quelle `disposition` kennzeichnet die Entlassung aus der Disposition.
--
--    Die Tabelle ist ein Blatt (nur der Selbstbezug `ursprung_id`, gemessen per grep über
--    migrations/), ohne AUTOINCREMENT, ohne Trigger und Views. Die alte Tabelle wird zuerst
--    umbenannt: so legt der Neubau seinen Selbstbezug unter dem endgültigen Namen an, und das
--    DROP der alten setzt nur deren eigene Zeilen auf NULL. Schema = 0130 1:1 (keine späteren
--    ADD COLUMN), geändert sind nur die beiden ON DELETE und der CHECK auf `quelle`.
--    Abgesichert von db::tests::migration_0193_* und zeitachse::repo::tests (Schema).
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
    -- disposition = aus dem Entlassen einer Kraft (LLH-1079)
    quelle         TEXT    NOT NULL
                   CHECK (quelle IN ('status', 'einheit', 'abloesung', 'nachtrag', 'disposition')),
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
