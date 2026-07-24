-- LFH-321 (Inkrement C): Lage-Snapshot — unveränderlicher Stand des vollen Lagebilds.
-- Ein JSON-Dokument je Snapshot (`daten`, mit `schema_version`); das Dokument friert die
-- rohen `*Anzeige`-DTOs der Lagekarte-Quellen ein. Einsatzweit (orthogonal zu Ansichten),
-- manuell ausgelöst. `daten`/`stand_at`/`erstellt_*` sind nach dem Anlegen unveränderlich.
CREATE TABLE lage_snapshot (
    id             INTEGER PRIMARY KEY,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    bezeichnung    TEXT,
    notiz          TEXT,
    stand_at       TEXT    NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    daten          TEXT    NOT NULL,
    erstellt_von   INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lage_snapshot_einsatz ON lage_snapshot(einsatz_id, stand_at);
