-- Einsatzabschnitt-Baum (einsatzbezogen, Führungs-Gliederung). Selbstreferenz
-- ueber_abschnitt_id (NULL = oberste Ebene); Zyklen-Schutz app-seitig. leiter_id
-- referenziert eine disponierte Person desselben Einsatzes (optional). Name bewusst
-- NICHT eindeutig (zwei "Abschnitt Nord" auf verschiedenen Ebenen erlaubt).
CREATE TABLE einsatzabschnitt (
    id                 INTEGER PRIMARY KEY,
    einsatz_id         INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    ueber_abschnitt_id INTEGER REFERENCES einsatzabschnitt(id),
    name               TEXT NOT NULL,
    leiter_id          INTEGER REFERENCES einsatz_personal(id),
    bemerkung          TEXT,
    sortier            INTEGER NOT NULL DEFAULT 0,
    angelegt_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_einsatzabschnitt_einsatz ON einsatzabschnitt(einsatz_id);
