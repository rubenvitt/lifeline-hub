-- no-transaction
-- LFH-1040: Gerätekopplung für weitere Stellen. Vier neue Funktionsansichten im CHECK
-- (betreuungsstelle, bereitstellungsraum, einsatzabschnitt, verpflegung) und je Stellenart eine
-- eigene Bindungsspalte mit Fremdschlüssel neben `uhs_id`. Wire-Werte: `geraet::Funktionsansicht`
-- und `geraet::Stellenart` (Guard: tests/enum_wire_kontrakt.rs).
--
-- SQLite ändert einen Spalten-CHECK nur per Tabellen-Rebuild. geraet_kopplung ist kein Leaf:
--   geraet_kopplungscode.kopplung_id      (PRIMARY KEY, ON DELETE CASCADE)
--   geraet_kopplung_ereignis.kopplung_id  (NOT NULL, ON DELETE CASCADE)
--   session.kopplung_id                   (ON DELETE CASCADE)
-- Ein DROP TABLE mit eingeschalteten Fremdschlüsseln löschte über die Kaskade alle Codes,
-- Ereignisse und Gerätesitzungen. Deshalb `-- no-transaction` und PRAGMA foreign_keys = OFF
-- (Muster 0082; sqlx 0.9 honoriert die Direktive). Die ids bleiben 1:1, sodass alle Kind-FKs nach
-- dem RENAME weiter auflösen. Ohne AUTOINCREMENT (wie 0147) gibt es keinen sqlite_sequence-Eintrag.
-- Schema = 0147 1:1 (keine späteren ADD COLUMN) plus die drei Bindungsspalten und den
-- Höchstens-eine-Stelle-CHECK.
--
-- Bindung: höchstens eine Stellenspalte ist gesetzt; welche zur Ansicht passt, prüft der Code
-- (`Funktionsansicht::stellenart`). UHS, Betreuungsstelle und Bereitstellungsraum werden nur
-- storniert, nie gelöscht. Ein Einsatzabschnitt wird beim Auflösen gelöscht; der Handler
-- widerruft vorher jede offene Kopplung an ihm, ON DELETE SET NULL hält die widerrufenen Zeilen.
-- Abgesichert von db::tests::migration_0159_*.

PRAGMA foreign_keys = OFF;

CREATE TABLE geraet_kopplung_neu (
    id                     INTEGER PRIMARY KEY,
    einsatz_id             INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    benutzer_id            INTEGER NOT NULL UNIQUE REFERENCES benutzer(id),
    ansicht                TEXT    NOT NULL CHECK (ansicht IN (
                               'uhs-tablet', 'uhs-laptop', 'lagemonitor', 'betreuungsstelle',
                               'bereitstellungsraum', 'einsatzabschnitt', 'verpflegung')),
    -- Stelle der stellengebundenen Ansichten, je Art eine Spalte.
    uhs_id                 INTEGER REFERENCES uhs(id),
    bezeichnung            TEXT    NOT NULL,             -- „Tablet 1“, ≤ 60 Zeichen
    erstellt_von           INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    laeuft_ab_at           TEXT    NOT NULL,
    gekoppelt_at           TEXT,                         -- letzte Einlösung eines Codes
    letzter_zugriff_at     TEXT,                         -- höchstens minütlich fortgeschrieben
    widerrufen_at          TEXT,
    widerrufen_von         INTEGER REFERENCES benutzer(id),
    betreuungsstelle_id    INTEGER REFERENCES betreuungsstelle(id),
    bereitstellungsraum_id INTEGER REFERENCES bereitstellungsraum(id),
    abschnitt_id           INTEGER REFERENCES einsatzabschnitt(id) ON DELETE SET NULL,
    CHECK ((uhs_id IS NOT NULL) + (betreuungsstelle_id IS NOT NULL)
           + (bereitstellungsraum_id IS NOT NULL) + (abschnitt_id IS NOT NULL) <= 1)
);

INSERT INTO geraet_kopplung_neu
    (id, einsatz_id, benutzer_id, ansicht, uhs_id, bezeichnung, erstellt_von, erstellt_at,
     laeuft_ab_at, gekoppelt_at, letzter_zugriff_at, widerrufen_at, widerrufen_von)
    SELECT id, einsatz_id, benutzer_id, ansicht, uhs_id, bezeichnung, erstellt_von, erstellt_at,
           laeuft_ab_at, gekoppelt_at, letzter_zugriff_at, widerrufen_at, widerrufen_von
    FROM geraet_kopplung;

DROP TABLE geraet_kopplung;

ALTER TABLE geraet_kopplung_neu RENAME TO geraet_kopplung;

CREATE INDEX idx_geraet_kopplung_einsatz ON geraet_kopplung (einsatz_id);
CREATE INDEX idx_geraet_kopplung_abschnitt ON geraet_kopplung (abschnitt_id);

PRAGMA foreign_keys = ON;
