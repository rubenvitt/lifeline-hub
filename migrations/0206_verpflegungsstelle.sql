-- LLH-1040: Verpflegungsstellen als eigene Stelle, Zuordnung der Zeitfenster und Ausgaben
-- (design.md D1, D8). Nur additive Änderungen, kein Neubau: der Bestand bleibt ohne Stelle, ohne
-- Zuordnung und ohne Verpflegungsart und sieht aus wie bisher.
--
-- Status wie beim Bereitstellungsraum (`0060`): `geplant → aktiv → aufgeloest`, `aufgeloest` ist
-- endgültig und trägt seinen Zeitpunkt (CHECK koppelt beides). Storniert wird weich
-- (`storniert_at`), nur eine geplante Stelle ohne Ausgabe; gelöscht wird eine Stelle nur mit dem
-- Einsatz. Eindeutig ist die Bezeichnung unter den NICHT stornierten Stellen eines Einsatzes
-- (partieller UNIQUE-Index wie `idx_betreuungsstelle_bezeichnung`): eine Stornierung ist eine
-- Fehlanlage, ihr Name wird wieder frei. Die Vorabprüfung im Repo antwortet mit 409; der Index ist
-- das Netz. Die Koordinate ist ein Paar, das die App sichert (wie `0118`).
CREATE TABLE verpflegungsstelle (
    id               INTEGER PRIMARY KEY,
    einsatz_id       INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    bezeichnung      TEXT    NOT NULL,
    art              TEXT    NOT NULL
        CHECK (art IN ('feldkueche','ausgabestelle','zufuehrung')),
    standort         TEXT,
    lat              REAL,
    lon              REAL,
    abschnitt_id     INTEGER REFERENCES einsatzabschnitt(id) ON DELETE SET NULL,
    status           TEXT    NOT NULL DEFAULT 'geplant'
        CHECK (status IN ('geplant','aktiv','aufgeloest')),
    aufgeloest_at    TEXT,
    storniert_at     TEXT,
    storniert_von_id INTEGER REFERENCES benutzer(id),
    angelegt_von_id  INTEGER NOT NULL REFERENCES benutzer(id),
    angelegt_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    geaendert_at     TEXT,
    CHECK ((status = 'aufgeloest') = (aufgeloest_at IS NOT NULL))
);
CREATE INDEX idx_verpflegungsstelle_einsatz ON verpflegungsstelle(einsatz_id, status);
CREATE UNIQUE INDEX idx_verpflegungsstelle_bezeichnung
    ON verpflegungsstelle(einsatz_id, bezeichnung) WHERE storniert_at IS NULL;

-- Zuordnung Zeitfenster–Stelle (n:m). Kein Soll je Stelle (entscheidungen.md Punkt 2); ein Soll
-- käme später als ADD COLUMN hierher. `einsatz_id` ist redundant, aber nötig: die
-- Schwärzungs-Registry entdeckt einsatzbezogene Tabellen über `einsatz_id` + CASCADE, und das
-- Laden je Einsatz braucht keinen Join (Muster und Begründung `0120`).
CREATE TABLE verpflegung_zeitfenster_stelle (
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    zeitfenster_id INTEGER NOT NULL REFERENCES verpflegung_zeitfenster(id) ON DELETE CASCADE,
    stelle_id      INTEGER NOT NULL REFERENCES verpflegungsstelle(id) ON DELETE CASCADE,
    PRIMARY KEY (zeitfenster_id, stelle_id)
);
CREATE INDEX idx_verpflegung_zeitfenster_stelle_stelle
    ON verpflegung_zeitfenster_stelle(stelle_id);

-- Ausgabe an einer Stelle (optional). SET NULL wie `nachforderung_id`; eine Stelle wird nur mit
-- dem Einsatz gelöscht, und dann gehen die Ausgaben ohnehin mit.
ALTER TABLE verpflegung_ausgabe ADD COLUMN verpflegungsstelle_id INTEGER
    REFERENCES verpflegungsstelle(id) ON DELETE SET NULL;
CREATE INDEX idx_verpflegung_ausgabe_stelle ON verpflegung_ausgabe(verpflegungsstelle_id);

-- Verpflegungsart (LLH-1024 F5): nur Anzeige, die Deckung gilt für alle Arten gleich. NULL heißt
-- „ohne Angabe“; der Bestand bekommt keine Vorgabe, sonst hieße ein Getränke-Fenster still „warm“.
ALTER TABLE verpflegung_zeitfenster ADD COLUMN verpflegungsart TEXT
    CHECK (verpflegungsart IN ('warm','kalt','getraenke'));
