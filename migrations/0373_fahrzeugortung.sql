-- LLH-2091 (Entwurf `docs/superpowers/specs/2026-11-24-fjftaovq-fahrzeugortung-design.md`,
-- Abschnitt „Daten“): Fahrzeugortung aus dem Einwurf. Ein Einsatzfahrzeug wird an eine Kennung
-- eines Einwurf-Zugangs gekoppelt; die Position trägt ihre Quelle und zwei Zeiten.

-- Eine Zeile je gekoppeltem Einsatzfahrzeug. Trennen löscht die Zeile; die Spur steht im ETB.
-- Die Tabelle wird nicht gespiegelt und nicht in die API v1 geliefert (lokale Betriebsangabe).
CREATE TABLE ortung_kopplung (
    einsatz_fahrzeug_id INTEGER PRIMARY KEY REFERENCES einsatz_fahrzeug(id) ON DELETE CASCADE,
    einsatz_id          INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    org_id              INTEGER NOT NULL,
    zugang_id           TEXT    NOT NULL REFERENCES einwurf_zugang(id) ON DELETE CASCADE,
    kennung             TEXT    NOT NULL,
    ehrenamt_bestaetigt INTEGER NOT NULL CHECK (ehrenamt_bestaetigt IN (0, 1)),
    gekoppelt_at        TEXT    NOT NULL,
    gekoppelt_von       INTEGER NOT NULL,
    -- eine Kennung hängt zur selben Zeit an höchstens einem Einsatzfahrzeug, über alle Einsätze
    UNIQUE (zugang_id, kennung)
);
CREATE INDEX idx_ortung_kopplung_einsatz ON ortung_kopplung (einsatz_id);

-- Quelle und Zeiten der Position; alle NULL ohne Position.
--  - position_gemessen_at: bei `ortung` die Messzeit des Geräts, bei `manuell` die Serverzeit
--    des Setzens (trägt die Altersanzeige).
--  - position_gesetzt_at: immer Serverzeit (trägt den Vorrang zwischen manuell und Ortung).
ALTER TABLE einsatz_fahrzeug
    ADD COLUMN position_quelle TEXT CHECK (position_quelle IN ('manuell', 'ortung'));
ALTER TABLE einsatz_fahrzeug ADD COLUMN position_gemessen_at TEXT;
ALTER TABLE einsatz_fahrzeug ADD COLUMN position_gesetzt_at TEXT;

-- Bestand: eine vorhandene Position war manuell gesetzt, ihre Zeiten sind unbekannt.
UPDATE einsatz_fahrzeug SET position_quelle = 'manuell' WHERE lat IS NOT NULL;

-- Ortung auch bei hauptamtlicher Besatzung (NULL/0 = aus, 1 = an). Bleibt lokal: nicht Teil der
-- Stammdaten-Synchronisation.
ALTER TABLE org_einstellungen ADD COLUMN ortung_hauptamt INTEGER;
