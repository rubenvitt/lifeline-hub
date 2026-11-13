-- LLH-1638 (Change f658d8o6-lage-fuer-maschinenzugaenge, design.md D2): Freigabe eines Einsatzes
-- für einen Maschinenzugang durch die Einsatzleitung. Lese-Scopes mit Einsatzbezug (`lage:read`)
-- sehen nur den Einsatz, der hier für den Zugang steht (ADR-0022, ADR-0035).

CREATE TABLE maschinenzugang_freigabe (
    zugang_id       TEXT    NOT NULL REFERENCES maschinenzugang(id) ON DELETE CASCADE,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    freigegeben_von INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    freigegeben_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (zugang_id, einsatz_id)
);

-- Ein Zugang liest höchstens einen Einsatz. Das trägt dieser Index, nicht der Primärschlüssel:
-- sollen es später mehrere sein (LLH-1655), fällt nur der Index, ohne Tabellenumbau.
CREATE UNIQUE INDEX idx_maschinenzugang_freigabe_zugang ON maschinenzugang_freigabe (zugang_id);
CREATE INDEX idx_maschinenzugang_freigabe_einsatz ON maschinenzugang_freigabe (einsatz_id);
