-- LLH-2091 (Entwurf `docs/superpowers/specs/2026-11-24-fjftaovq-fahrzeugortung-design.md`,
-- Abschnitt „Daten“ und „Nachtrag 25.11.2026“, ADR-0103): Fahrzeugortung aus dem Einwurf. Ein
-- Einsatzfahrzeug wird an eine Kennung eines Einwurf-Zugangs gekoppelt. Quelle und Zeitpunkt der
-- Position trägt der Positionsbaustein aus 0377 (`position_quelle`, `position_aktualisiert_at`),
-- den Org-Schalter `org_einstellungen.ortung_im_einsatz` ebenfalls 0377 (ADR-0101).

-- Eine Zeile je gekoppeltem Einsatzfahrzeug. Trennen löscht die Zeile; die Spur steht im ETB.
-- Die Tabelle wird nicht gespiegelt und nicht in die API v1 geliefert (lokale Betriebsangabe).
CREATE TABLE ortung_kopplung (
    einsatz_fahrzeug_id INTEGER PRIMARY KEY REFERENCES einsatz_fahrzeug(id) ON DELETE CASCADE,
    einsatz_id          INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    org_id              INTEGER NOT NULL,
    zugang_id           TEXT    NOT NULL REFERENCES einwurf_zugang(id) ON DELETE CASCADE,
    kennung             TEXT    NOT NULL,
    gekoppelt_at        TEXT    NOT NULL,
    gekoppelt_von       INTEGER NOT NULL,
    -- eine Kennung hängt zur selben Zeit an höchstens einem Einsatzfahrzeug, über alle Einsätze
    UNIQUE (zugang_id, kennung)
);
CREATE INDEX idx_ortung_kopplung_einsatz ON ortung_kopplung (einsatz_id);
