-- LLH-1484: Lesezugang für externe Anzeigen (FüKW-Lagemonitor) und seine Freigabe am Einsatz.
-- Herleitung: /mnt/project-files/llh-1484/design.md (D1, D3).
--
-- Ein Lesezugang ist kein Benutzer und keine Sitzung: er öffnet allein
-- `GET /api/lagemonitor/v1/lage` (`lagemonitor_zugang::LagemonitorZugriff`). In der DB steht nur
-- der SHA-256 des Schlüssels, wie beim Sitzungstoken und beim Kopplungscode.
CREATE TABLE lagemonitor_zugang (
    id                 INTEGER PRIMARY KEY,
    org_id             INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    bezeichnung        TEXT    NOT NULL,             -- „FüKW 40-12-1“, ≤ 60 Zeichen
    schluessel_hash    TEXT    NOT NULL UNIQUE,
    angelegt_von       INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    angelegt_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    zuletzt_genutzt_at TEXT,                         -- höchstens minütlich fortgeschrieben
    widerrufen_at      TEXT,
    widerrufen_von     INTEGER REFERENCES benutzer(id) ON DELETE SET NULL
);
CREATE INDEX idx_lagemonitor_zugang_org ON lagemonitor_zugang (org_id);

-- Welcher Einsatz an einem Zugang gezeigt wird. Der Primärschlüssel hält „höchstens ein Einsatz
-- je Zugang“; ein Einsatz kann an mehreren Zugängen stehen. Der Abschluss des Einsatzes löscht
-- seine Zeilen (`einsatz::repo::abschliessen`).
CREATE TABLE lagemonitor_freigabe (
    zugang_id       INTEGER PRIMARY KEY REFERENCES lagemonitor_zugang(id) ON DELETE CASCADE,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    freigegeben_von INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    freigegeben_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lagemonitor_freigabe_einsatz ON lagemonitor_freigabe (einsatz_id);

