-- LFH-551: Checkliste Arbeitsaufnahme der Führungseinheit. Sieben feste Punkte (LFS-BW F5-I
-- Kap. 5; HLFS „Aufgaben S3“ Kap. 5; FwDV 100 Anlage 5) als Arbeitsmittel am Fahrzeug, KEIN
-- Führungsnachweis. Eine Zeile entsteht erst beim ersten Haken oder der ersten Bemerkung;
-- keine Zeile = offen, ohne Bemerkung. Ein entfernter Haken lässt die Zeile stehen, damit die
-- Bemerkung überlebt. Den einzigen Nachweis (Meldung an die Leitstelle) trägt das ETB.
CREATE TABLE einsatz_stab_checkliste (
    id               INTEGER PRIMARY KEY,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    punkt            TEXT    NOT NULL CHECK (punkt IN ('aufstellort','einweisung','lageskizze',
                                                   'funkarbeitsplaetze','sprechgruppen',
                                                   'etb_eroeffnet','leitstelle_gemeldet')),
    erledigt         INTEGER NOT NULL DEFAULT 0 CHECK (erledigt IN (0, 1)),
    erledigt_at      TEXT,             -- Moment des Hakens; bleibt bei erneutem „erledigt“ stehen
    erledigt_von_id  INTEGER REFERENCES benutzer(id),
    bemerkung        TEXT,             -- ≤ 500 Zeichen, leer = NULL
    geaendert_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (einsatz_id, punkt),
    CHECK ((erledigt = 1) = (erledigt_at IS NOT NULL)),
    CHECK ((erledigt = 1) = (erledigt_von_id IS NOT NULL))
);
