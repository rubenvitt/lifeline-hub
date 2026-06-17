-- E‑3: Belegungs-Verlauf (append-only — kein UPDATE/DELETE) + denormalisierter
-- Cache auf einsatz_einheit und einsatz_fahrzeug. Jeder Insert pflegt den Cache
-- in derselben Tx (Repo-Aufgabe).
ALTER TABLE einsatz_einheit  ADD COLUMN aktueller_br_id INTEGER REFERENCES bereitstellungsraum(id);
ALTER TABLE einsatz_fahrzeug ADD COLUMN aktueller_br_id INTEGER REFERENCES bereitstellungsraum(id);

-- Polymorphe Belegung über Code-Guard, kein FK (zwei mögliche Zieltabellen).
CREATE TABLE br_belegung (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id   INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    br_id        INTEGER NOT NULL REFERENCES bereitstellungsraum(id),
    objekt_typ   TEXT    NOT NULL CHECK (objekt_typ IN ('einheit','fahrzeug')),
    objekt_id    INTEGER NOT NULL,                  -- einsatz_einheit.id ODER einsatz_fahrzeug.id (Code-Guard, kein FK)
    art          TEXT    NOT NULL CHECK (art IN ('eintritt','wechsel','austritt')),
    notiz        TEXT,
    zeitpunkt_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von  INTEGER NOT NULL REFERENCES benutzer(id)
);
CREATE INDEX idx_br_belegung_br     ON br_belegung (br_id, zeitpunkt_at);
CREATE INDEX idx_br_belegung_objekt ON br_belegung (objekt_typ, objekt_id, zeitpunkt_at);
