-- LFH-606: maßgebliche Pegel eines Einsatzes (PEGELONLINE-Stationen). Der erste in der
-- Reihenfolge ist der Leitpegel der Kennzahl. Eigene Tabelle statt `einsatz_einstellungen`:
-- deren PUT ist Vollersatz (LFH-345/C10), ein Feld dort nullte jede andere Sektion still.
-- `name`/`gewaesser` sind ein Snapshot zum Festlegen — die Kennzahl steht auch dann
-- beschriftet da, wenn die Stationsliste der Fachebene gerade nicht erreichbar ist.
CREATE TABLE einsatz_pegel (
    id             INTEGER PRIMARY KEY,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    station_uuid   TEXT    NOT NULL,
    name           TEXT    NOT NULL,
    gewaesser      TEXT,
    reihenfolge    INTEGER NOT NULL,
    gesetzt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    gesetzt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (einsatz_id, station_uuid)
);
CREATE INDEX idx_einsatz_pegel_einsatz ON einsatz_pegel(einsatz_id, reihenfolge);
