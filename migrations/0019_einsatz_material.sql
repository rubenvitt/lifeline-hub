-- Disposition: Zuordnung von Stamm-/Ad-hoc-Material zu einem konkreten Einsatz.
-- Menge sitzt auf der Dispositionszeile (kein Bestandszähler im Stamm). Status ist
-- ein festes Enum (kein Katalog). Identitäts-Schnappschuss (snap_*) für
-- Nachvollziehbarkeit / Ad-hoc-Daten. KEIN UNIQUE(einsatz_id, material_id):
-- dieselbe Art darf mehrfach als getrennte Position (Mengen-Splitting auf Einheiten).
CREATE TABLE einsatz_material (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    material_id     INTEGER REFERENCES material(id),          -- NULL = Ad-hoc extern
    einheit_id      INTEGER REFERENCES einsatz_einheit(id),   -- Mitgliedschaft (exklusiv); NULL = frei
    menge           INTEGER NOT NULL DEFAULT 1 CHECK (menge >= 1),
    status          TEXT NOT NULL DEFAULT 'einsatzbereit'
                    CHECK (status IN ('einsatzbereit', 'im_einsatz', 'defekt', 'verbraucht', 'desinfektion_noetig')),
    -- Identitäts-Schnappschuss (eingefroren beim Disponieren);
    -- bei Ad-hoc-extern sind dies die eigentlichen Daten:
    snap_bezeichnung         TEXT NOT NULL,
    snap_kategorie           TEXT,
    snap_bestandsnummer      TEXT,
    snap_traegerorganisation TEXT,
    bemerkung       TEXT,
    disponiert_at   TEXT NOT NULL DEFAULT (datetime('now')),
    disponiert_von  INTEGER REFERENCES benutzer(id)
);

CREATE INDEX idx_einsatz_material_einsatz ON einsatz_material(einsatz_id);
