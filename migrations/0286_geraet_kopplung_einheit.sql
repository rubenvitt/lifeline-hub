-- no-transaction
-- LLH-1579: Funktionsansicht „Einheit“ (Konzept LLH-1571, Stufe S1). Ein Handy arbeitet für genau
-- eine Einheit des Einsatzes: ihre Aufträge, ihr Status, ihre Meldungen. Neuer Wire-Wert
-- `einheit` im CHECK der Ansicht und sechste Bindungsspalte `einheit_id` neben `uhs_id`,
-- `betreuungsstelle_id`, `bereitstellungsraum_id`, `abschnitt_id` und `verpflegungsstelle_id`;
-- der Höchstens-eine-Stelle-CHECK zählt sie mit. Wire-Werte: `geraet::Funktionsansicht::Einheit`
-- und `geraet::Bindungsart::Einheit` (Guard: tests/enum_wire_kontrakt.rs).
--
-- SQLite ändert einen Tabellen-CHECK nur per Rebuild, und geraet_kopplung ist kein Leaf:
--   geraet_kopplungscode.kopplung_id      (PRIMARY KEY, ON DELETE CASCADE)
--   geraet_kopplung_ereignis.kopplung_id  (NOT NULL, ON DELETE CASCADE)
--   session.kopplung_id                   (ON DELETE CASCADE)
-- Ein DROP TABLE mit eingeschalteten Fremdschlüsseln löschte über die Kaskade alle Codes,
-- Ereignisse und Gerätesitzungen. Deshalb `-- no-transaction` und PRAGMA foreign_keys = OFF
-- (Muster 0159, 0213). Die ids bleiben 1:1, sodass alle Kind-FKs nach dem RENAME weiter auflösen.
-- Schema = 0213 1:1 plus die neue Ansicht und die neue Spalte am Ende.
--
-- Eine Einheit ohne jede Spur wird beim Auflösen echt gelöscht (`einheit::repo::aufloesen_tx`).
-- Das Auflösen widerruft ihre Kopplungen vorher; ON DELETE SET NULL hält die widerrufene Zeile
-- dann stehen (wie `abschnitt_id`), statt das Löschen der Einheit zu blockieren.
-- Abgesichert von db::tests::migration_0286_*.

PRAGMA foreign_keys = OFF;

CREATE TABLE geraet_kopplung_neu (
    id                     INTEGER PRIMARY KEY,
    einsatz_id             INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    benutzer_id            INTEGER NOT NULL UNIQUE REFERENCES benutzer(id),
    ansicht                TEXT    NOT NULL CHECK (ansicht IN (
                               'uhs-tablet', 'uhs-laptop', 'lagemonitor', 'betreuungsstelle',
                               'bereitstellungsraum', 'einsatzabschnitt', 'verpflegung',
                               'einheit')),
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
    verpflegungsstelle_id  INTEGER REFERENCES verpflegungsstelle(id),
    einheit_id             INTEGER REFERENCES einsatz_einheit(id) ON DELETE SET NULL,
    CHECK ((uhs_id IS NOT NULL) + (betreuungsstelle_id IS NOT NULL)
           + (bereitstellungsraum_id IS NOT NULL) + (abschnitt_id IS NOT NULL)
           + (verpflegungsstelle_id IS NOT NULL) + (einheit_id IS NOT NULL) <= 1)
);

INSERT INTO geraet_kopplung_neu
    (id, einsatz_id, benutzer_id, ansicht, uhs_id, bezeichnung, erstellt_von, erstellt_at,
     laeuft_ab_at, gekoppelt_at, letzter_zugriff_at, widerrufen_at, widerrufen_von,
     betreuungsstelle_id, bereitstellungsraum_id, abschnitt_id, verpflegungsstelle_id)
    SELECT id, einsatz_id, benutzer_id, ansicht, uhs_id, bezeichnung, erstellt_von, erstellt_at,
           laeuft_ab_at, gekoppelt_at, letzter_zugriff_at, widerrufen_at, widerrufen_von,
           betreuungsstelle_id, bereitstellungsraum_id, abschnitt_id, verpflegungsstelle_id
    FROM geraet_kopplung;

DROP TABLE geraet_kopplung;

ALTER TABLE geraet_kopplung_neu RENAME TO geraet_kopplung;

CREATE INDEX idx_geraet_kopplung_einsatz ON geraet_kopplung (einsatz_id);
CREATE INDEX idx_geraet_kopplung_abschnitt ON geraet_kopplung (abschnitt_id);
CREATE INDEX idx_geraet_kopplung_einheit ON geraet_kopplung (einheit_id);

PRAGMA foreign_keys = ON;
