-- Org-/Systemweite Rolle, die das ANLEGEN von Einsätzen erlaubt. Orthogonal zu
-- system_rolle: 'fuehrungskraft' = darf Einsätze eröffnen, 'keine' = nicht.
-- Admins dürfen ohnehin (Capability = system_rolle='admin' ODER org_rolle='fuehrungskraft').
ALTER TABLE benutzer
    ADD COLUMN org_rolle TEXT NOT NULL DEFAULT 'keine'
    CHECK (org_rolle IN ('fuehrungskraft', 'keine'));

-- Einsatz: mehrere können parallel aktiv sein. status: 'aktiv' | 'abgeschlossen'.
-- Abgeschlossene Einsätze sind read-only (keine Wiedereröffnung in T1).
CREATE TABLE einsatz (
    id                INTEGER PRIMARY KEY,
    org_id            INTEGER NOT NULL REFERENCES organisation(id),
    bezeichnung       TEXT NOT NULL,
    stichwort         TEXT,
    status            TEXT NOT NULL DEFAULT 'aktiv'
                      CHECK (status IN ('aktiv', 'abgeschlossen')),
    begonnen_at       TEXT NOT NULL DEFAULT (datetime('now')),
    abgeschlossen_at  TEXT,
    abgeschlossen_von INTEGER REFERENCES benutzer(id)
);

-- Mitgliedschaft: ein Benutzer hat in einem Einsatz genau eine Einsatz-Rolle.
CREATE TABLE einsatz_mitgliedschaft (
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    benutzer_id   INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    einsatz_rolle TEXT NOT NULL
                  CHECK (einsatz_rolle IN ('einsatzleitung', 'fuehrungspersonal', 'beobachter')),
    zugewiesen_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (einsatz_id, benutzer_id)
);

CREATE INDEX idx_mitgliedschaft_benutzer ON einsatz_mitgliedschaft(benutzer_id);
