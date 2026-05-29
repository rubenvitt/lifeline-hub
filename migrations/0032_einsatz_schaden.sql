-- E‑5: Einsatz-scoped Schadens-Entity (Sach-/Infrastruktur-/Umweltschäden inkl.
-- Tierkadaver + Verkehrshindernisse). Schaden ist Arbeitsauftrag: Status-Maschine
-- offen → uebergeben → abgeschlossen. Geschädigter als FK XOR Freitext (beides NULL =
-- unbekannt/öffentlich). Soft-Delete via storniert_at (kein Hard-Delete). Kein
-- Lese-Audit (keine DSGVO-besondere Kategorie). Koordinaten → T4 (ort als Freitext).
CREATE TABLE einsatz_schaden (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id               INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    registrier_nr            INTEGER NOT NULL,
    status                   TEXT    NOT NULL DEFAULT 'offen'
                             CHECK (status IN ('offen','uebergeben','abgeschlossen')),
    typ                      TEXT    NOT NULL
                             CHECK (typ IN ('sachschaden','verkehrshindernis','infrastruktur',
                                            'umweltschaden','tierkadaver','sonstige')),
    ausmass                  TEXT    NOT NULL
                             CHECK (ausmass IN ('gering','mittel','gross','katastrophal')),
    ort                      TEXT    NOT NULL,
    beschreibung             TEXT    NOT NULL DEFAULT '',
    geschaedigt_person_id    INTEGER REFERENCES einsatz_person(id),
    geschaedigt_kontakt      TEXT,
    uebergeben_an            TEXT,
    uebergeben_at            TEXT,
    abschluss_grund          TEXT
                             CHECK (abschluss_grund IS NULL OR abschluss_grund IN
                                    ('behoben','kein_handlungsbedarf','abgewiesen')),
    abschluss_at             TEXT,
    erfasst_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von              INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    geaendert_von            INTEGER NOT NULL REFERENCES benutzer(id),
    storniert_at             TEXT,
    storniert_von            INTEGER REFERENCES benutzer(id),

    UNIQUE (einsatz_id, registrier_nr),
    CHECK (geschaedigt_person_id IS NULL OR geschaedigt_kontakt IS NULL),
    CHECK (status <> 'uebergeben'    OR uebergeben_an   IS NOT NULL),
    CHECK (status <> 'abgeschlossen' OR abschluss_grund IS NOT NULL)
);

CREATE INDEX idx_einsatz_schaden_einsatz      ON einsatz_schaden (einsatz_id, status);
CREATE INDEX idx_einsatz_schaden_geschaedigt  ON einsatz_schaden (geschaedigt_person_id)
    WHERE geschaedigt_person_id IS NOT NULL;
CREATE INDEX idx_einsatz_schaden_offen        ON einsatz_schaden (einsatz_id)
    WHERE status <> 'abgeschlossen' AND storniert_at IS NULL;
