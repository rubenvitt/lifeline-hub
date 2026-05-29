-- E‑5: Geschädigter als EINE von vier sich ausschließenden Quellen (oder keine):
--   1. Betroffene Person   → geschaedigt_person_id       (einsatz_person)
--   2. Einsatzkraft        → geschaedigt_personal_id     (einsatz_personal)
--   3. Eigene Organisation → geschaedigt_organisation_id (organisation, immer eigene Org)
--   4. Extern              → geschaedigt_kontakt         (Freitext)
-- Alle NULL = unbekannt/öffentlich. SQLite kann einen Tabellen-CHECK nicht per ALTER
-- ändern → Standard-Tabellen-Rebuild (einsatz_schaden ist Leaf-Tabelle, nichts
-- referenziert sie). Schema aus 0032 1:1 reproduziert + zwei neue Spalten + neuer
-- 4‑Wege-„höchstens eins"-CHECK. Kein PRAGMA-foreign_keys-Toggle nötig (Migration
-- läuft in einer Transaktion, Leaf-Rebuild braucht es nicht).
CREATE TABLE einsatz_schaden_neu (
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
    geschaedigt_personal_id      INTEGER REFERENCES einsatz_personal(id) ON DELETE SET NULL,
    geschaedigt_organisation_id  INTEGER REFERENCES organisation(id),
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
    CHECK ( (geschaedigt_person_id       IS NOT NULL)
          + (geschaedigt_personal_id     IS NOT NULL)
          + (geschaedigt_organisation_id IS NOT NULL)
          + (geschaedigt_kontakt         IS NOT NULL) <= 1 ),
    CHECK (status <> 'uebergeben'    OR uebergeben_an   IS NOT NULL),
    CHECK (status <> 'abgeschlossen' OR abschluss_grund IS NOT NULL)
);

INSERT INTO einsatz_schaden_neu
    (id, einsatz_id, registrier_nr, status, typ, ausmass, ort, beschreibung,
     geschaedigt_person_id, geschaedigt_kontakt, uebergeben_an, uebergeben_at,
     abschluss_grund, abschluss_at, erfasst_at, erfasst_von, geaendert_at,
     geaendert_von, storniert_at, storniert_von)
SELECT
     id, einsatz_id, registrier_nr, status, typ, ausmass, ort, beschreibung,
     geschaedigt_person_id, geschaedigt_kontakt, uebergeben_an, uebergeben_at,
     abschluss_grund, abschluss_at, erfasst_at, erfasst_von, geaendert_at,
     geaendert_von, storniert_at, storniert_von
FROM einsatz_schaden;

DROP TABLE einsatz_schaden;
ALTER TABLE einsatz_schaden_neu RENAME TO einsatz_schaden;

CREATE INDEX idx_einsatz_schaden_einsatz      ON einsatz_schaden (einsatz_id, status);
CREATE INDEX idx_einsatz_schaden_geschaedigt  ON einsatz_schaden (geschaedigt_person_id)
    WHERE geschaedigt_person_id IS NOT NULL;
CREATE INDEX idx_einsatz_schaden_geschaedigt_personal ON einsatz_schaden (geschaedigt_personal_id)
    WHERE geschaedigt_personal_id IS NOT NULL;
CREATE INDEX idx_einsatz_schaden_offen        ON einsatz_schaden (einsatz_id)
    WHERE status <> 'abgeschlossen' AND storniert_at IS NULL;
