-- E‑3: Belegungs-Verlauf (append-only — kein UPDATE/DELETE) + denormalisierter
-- Cache auf einsatz_person. Jeder Insert pflegt den Cache in DERSELBEN Tx
-- (Repo-Aufgabe). Da Zeitstempel Server-Jetzt sind, ist „jüngster Event =
-- zuletzt eingefügt" garantiert (kein „bin ich der jüngste?"-Check nötig).
ALTER TABLE einsatz_person ADD COLUMN aktuelle_uhs_id    INTEGER REFERENCES uhs(id);
ALTER TABLE einsatz_person ADD COLUMN aktueller_platz_id INTEGER REFERENCES uhs_platz(id);

-- 1:1-Constraint: ein konkreter Platz max. eine Person gleichzeitig. Die Inbox
-- (platz_id IS NULL, uhs gesetzt) ist explizit unbegrenzt und vom Index nicht
-- erfasst (partieller Filter).
CREATE UNIQUE INDEX idx_einsatz_person_platz_belegt
    ON einsatz_person (aktueller_platz_id)
    WHERE aktueller_platz_id IS NOT NULL;

CREATE TABLE person_uhs_belegung (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id   INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id    INTEGER NOT NULL REFERENCES einsatz_person(id),
    uhs_id       INTEGER NOT NULL REFERENCES uhs(id),
    platz_id     INTEGER REFERENCES uhs_platz(id),     -- NULL = Inbox / Austritt
    art          TEXT    NOT NULL
                 CHECK (art IN ('eintritt','wechsel','austritt')),
    notiz        TEXT,                                 -- z. B. „durch Status-Wechsel zu verstorben"
    zeitpunkt_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von  INTEGER NOT NULL REFERENCES benutzer(id)
);
CREATE INDEX idx_person_uhs_belegung_person ON person_uhs_belegung (person_id, zeitpunkt_at);
CREATE INDEX idx_person_uhs_belegung_uhs    ON person_uhs_belegung (uhs_id,    zeitpunkt_at);
