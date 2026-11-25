-- Zuschaltung einer Drohnenquelle je Einsatz (LLH-2105). Ein Adapter (Art `suchlage`) wird einem
-- Einsatz zugeschaltet; solange dieser Einsatz läuft, hält er den Adapter. Die Datenbank ist die
-- Quelle der Wahrheit, `drohne::Store` nur ihr Abbild im Arbeitsspeicher. Ohne Personenbezug;
-- nichts aus der Drohnenlage selbst wird gespeichert.
CREATE TABLE adapter_einsatz (
    adapter_id      TEXT    NOT NULL REFERENCES adapter(id) ON DELETE CASCADE,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    zugeschaltet_at TEXT    NOT NULL,
    lagemonitor     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (adapter_id, einsatz_id)
);
CREATE INDEX idx_adapter_einsatz_einsatz ON adapter_einsatz (einsatz_id);
