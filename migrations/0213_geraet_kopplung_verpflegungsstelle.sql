-- no-transaction
-- LLH-1048: Ein Verpflegungsgerät kann an eine Verpflegungsstelle gebunden werden. Fünfte
-- Bindungsspalte `verpflegungsstelle_id` neben `uhs_id`, `betreuungsstelle_id`,
-- `bereitstellungsraum_id` und `abschnitt_id`; der Höchstens-eine-Stelle-CHECK zählt sie mit.
-- Wire-Wert der Art: `geraet::Bindungsart::Verpflegungsstelle` (Guard: tests/enum_wire_kontrakt.rs).
--
-- Die Bindung ist für die Ansicht `verpflegung` WAHLWEISE (LLH-1024 F7): ohne Stelle bleibt das
-- Gerät einsatzweit wie bisher. Jede Bestandskopplung kommt deshalb ohne Stelle herüber und
-- verhält sich unverändert.
--
-- SQLite ändert einen Tabellen-CHECK nur per Rebuild, und geraet_kopplung ist kein Leaf:
--   geraet_kopplungscode.kopplung_id      (PRIMARY KEY, ON DELETE CASCADE)
--   geraet_kopplung_ereignis.kopplung_id  (NOT NULL, ON DELETE CASCADE)
--   session.kopplung_id                   (ON DELETE CASCADE)
-- Ein DROP TABLE mit eingeschalteten Fremdschlüsseln löschte über die Kaskade alle Codes,
-- Ereignisse und Gerätesitzungen. Deshalb `-- no-transaction` und PRAGMA foreign_keys = OFF
-- (Muster 0159). Die ids bleiben 1:1, sodass alle Kind-FKs nach dem RENAME weiter auflösen.
-- Schema = 0159 1:1 (keine späteren Änderungen) plus die neue Spalte am Ende.
--
-- Eine Verpflegungsstelle wird nur storniert oder aufgelöst, gelöscht nur mit ihrem Einsatz, und
-- der nimmt die Kopplung per CASCADE mit (wie bei `uhs_id`). Deshalb kein ON DELETE: eine
-- verschwundene Stelle machte das Gerät sonst still einsatzweit.
-- Abgesichert von db::tests::migration_0213_*.

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
    verpflegungsstelle_id  INTEGER REFERENCES verpflegungsstelle(id),
    CHECK ((uhs_id IS NOT NULL) + (betreuungsstelle_id IS NOT NULL)
           + (bereitstellungsraum_id IS NOT NULL) + (abschnitt_id IS NOT NULL)
           + (verpflegungsstelle_id IS NOT NULL) <= 1)
);

INSERT INTO geraet_kopplung_neu
    (id, einsatz_id, benutzer_id, ansicht, uhs_id, bezeichnung, erstellt_von, erstellt_at,
     laeuft_ab_at, gekoppelt_at, letzter_zugriff_at, widerrufen_at, widerrufen_von,
     betreuungsstelle_id, bereitstellungsraum_id, abschnitt_id)
    SELECT id, einsatz_id, benutzer_id, ansicht, uhs_id, bezeichnung, erstellt_von, erstellt_at,
           laeuft_ab_at, gekoppelt_at, letzter_zugriff_at, widerrufen_at, widerrufen_von,
           betreuungsstelle_id, bereitstellungsraum_id, abschnitt_id
    FROM geraet_kopplung;

DROP TABLE geraet_kopplung;

ALTER TABLE geraet_kopplung_neu RENAME TO geraet_kopplung;

CREATE INDEX idx_geraet_kopplung_einsatz ON geraet_kopplung (einsatz_id);
CREATE INDEX idx_geraet_kopplung_abschnitt ON geraet_kopplung (abschnitt_id);

PRAGMA foreign_keys = ON;
