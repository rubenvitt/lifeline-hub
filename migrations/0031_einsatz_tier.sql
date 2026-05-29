-- E‑4: Einsatz-scoped Tier-Stamm (Haustier eines Betroffenen, herrenloses Tier,
-- vermisstes Tier). Kein globaler Stamm, keine Disposition. Identität optional;
-- server-vergebene registrier_nr ist die stabile Kennung (Anzeige T-nnn).
-- Schlanke Status-Maschine, Halter als FK XOR Freitext, Soft-Delete via
-- storniert_at (kein Hard-Delete). Kein Lese-Audit, kein Verbleibs-Event-Modell.
CREATE TABLE einsatz_tier (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    registrier_nr   INTEGER NOT NULL,          -- fortlaufend je Einsatz, server-autoritativ
    status          TEXT    NOT NULL DEFAULT 'aktiv'
                    CHECK (status IN ('aktiv','vermisst','abgeschlossen')),

    -- Spezies & Identität (alle außer spezies optional)
    spezies         TEXT    NOT NULL
                    CHECK (spezies IN ('hund','katze','grosstier','nutzgefluegel',
                                       'kleintier','wildtier','sonstige')),
    rasse_beschreibung TEXT,                   -- "Haflinger", "Deutscher Schäferhund"
    rufname         TEXT,
    geschlecht      TEXT CHECK (geschlecht IS NULL OR
                                geschlecht IN ('maennlich','weiblich','unbekannt')),
    alter_geschaetzt INTEGER,                  -- Jahre
    farbe_beschreibung TEXT,                   -- "schwarz mit weißer Brust"
    kennzeichnung   TEXT,                      -- Chip-Nr., Brandzeichen, Tätowierung, Halsband
    groesse_gewicht TEXT,                      -- "ca. 30 kg, mittelgroß"

    -- Halter (FK XOR Freitext; beides NULL = unbekannt)
    halter_person_id INTEGER REFERENCES einsatz_person(id),
    halter_kontakt  TEXT,                      -- Freitext: Name + Tel., wenn Halter nicht im Einsatz

    -- Erfassungskontext
    antreff_ort     TEXT,                      -- Freitext (analog E‑1; Tier-Sammelstelle = Folge-Spec)
    notiz           TEXT,

    -- Abschluss (gefüllt beim Übergang → abgeschlossen)
    abschluss_grund TEXT CHECK (abschluss_grund IS NULL OR abschluss_grund IN
                    ('uebergabe_halter','uebergabe_tierarzt','uebergabe_tierheim',
                     'verstorben','freilauf','sonstiges')),
    abschluss_ziel  TEXT,                      -- Freitext: "Tierarzt Müller, Hauptstr. 12"

    -- Meta / Audit
    erfasst_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von     INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_von   INTEGER NOT NULL REFERENCES benutzer(id),
    storniert_at    TEXT,                      -- Soft-Delete (Fehleingabe); kein Hard-Delete

    UNIQUE (einsatz_id, registrier_nr),
    CHECK (halter_person_id IS NULL OR halter_kontakt IS NULL),
    CHECK (status <> 'abgeschlossen' OR abschluss_grund IS NOT NULL)
);

CREATE INDEX idx_einsatz_tier_einsatz ON einsatz_tier (einsatz_id, status);
CREATE INDEX idx_einsatz_tier_halter  ON einsatz_tier (halter_person_id);
