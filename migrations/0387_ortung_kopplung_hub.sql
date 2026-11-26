-- LLH-2119 (Entwurf `docs/superpowers/specs/2026-11-25-ypcadxzo-fahrzeugortung-spiegel-design.md`,
-- Abschnitt „Daten“): Die Kopplung eines Einsatzfahrzeugs kann an einen Zugang des Hubs zeigen,
-- also an einen Einwurf-Zugang einer gekoppelten Instanz. Eine Zeile trägt genau eine Art:
-- lokal (`zugang_id`) oder Hub (`instanz_kopplung_id`, `fremder_zugang_id`, `zugang_name`).
-- Der Name des Hub-Zugangs steht in der Zeile, weil der lokale Zugang fehlt.
-- Blatt-Umbau ohne Marker (migrations/AGENTS.md): nichts verweist auf `ortung_kopplung`.
CREATE TABLE ortung_kopplung_neu (
    einsatz_fahrzeug_id INTEGER PRIMARY KEY REFERENCES einsatz_fahrzeug(id) ON DELETE CASCADE,
    einsatz_id          INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    org_id              INTEGER NOT NULL,
    zugang_id           TEXT    REFERENCES einwurf_zugang(id) ON DELETE CASCADE,
    instanz_kopplung_id INTEGER REFERENCES instanz_kopplung(id) ON DELETE CASCADE,
    fremder_zugang_id   TEXT,
    zugang_name         TEXT,
    kennung             TEXT    NOT NULL,
    gekoppelt_at        TEXT    NOT NULL,
    gekoppelt_von       INTEGER NOT NULL,
    CHECK (
        (zugang_id IS NOT NULL AND instanz_kopplung_id IS NULL
            AND fremder_zugang_id IS NULL AND zugang_name IS NULL)
        OR
        (zugang_id IS NULL AND instanz_kopplung_id IS NOT NULL
            AND fremder_zugang_id IS NOT NULL AND zugang_name IS NOT NULL)
    )
);

INSERT INTO ortung_kopplung_neu (einsatz_fahrzeug_id, einsatz_id, org_id, zugang_id, kennung,
                                 gekoppelt_at, gekoppelt_von)
SELECT einsatz_fahrzeug_id, einsatz_id, org_id, zugang_id, kennung, gekoppelt_at, gekoppelt_von
FROM ortung_kopplung;

DROP TABLE ortung_kopplung;
ALTER TABLE ortung_kopplung_neu RENAME TO ortung_kopplung;

-- eine Kennung hängt zur selben Zeit an höchstens einem Einsatzfahrzeug, je Art des Zugangs
CREATE UNIQUE INDEX ux_ortung_kopplung_lokal
    ON ortung_kopplung (zugang_id, kennung) WHERE zugang_id IS NOT NULL;
CREATE UNIQUE INDEX ux_ortung_kopplung_hub
    ON ortung_kopplung (instanz_kopplung_id, fremder_zugang_id, kennung)
    WHERE instanz_kopplung_id IS NOT NULL;
CREATE INDEX idx_ortung_kopplung_einsatz ON ortung_kopplung (einsatz_id);
