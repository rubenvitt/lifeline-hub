-- no-transaction
-- Helfer-App (Zunder vakwvkpg, Spec docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md,
-- ADR-0101). Schema für alle Stufen in einer Migration:
--
-- 1. Org-Schalter „Ortung im Einsatz“ mit Unterpunkt „Auch Personen orten“; Vorgabe aus. Wer den
--    ersten Schalter einschaltet, bestätigt Einwilligung bzw. Betriebsvereinbarung; wer und wann,
--    steht in `ortung_bestaetigt_von`/`_at` (geschrieben von `org::einstellungen::speichern`).
-- 2. Positionsbaustein an `einsatz_einheit`, `einsatz_fahrzeug`, `einsatz_personal`: Zeitpunkt und
--    Quelle der Position. Der Bestand bekommt `manuell` und keinen Zeitpunkt.
-- 3. `helfer_einladung`: ein QR-Code je Einsatz, über den sich Helfende selbst koppeln. Nur der
--    SHA-256 des Codes steht in der DB. Höchstens eine gültige Einladung je Einsatz sichert die
--    Logik, nicht die DB.
-- 4. Umbau `geraet_kopplung`: Ansicht `helfer` mit Zustand, Ziel (Einheit oder Fahrzeug), Person
--    und Ortungsgerät. Höchstens ein Ortungsgerät je Ziel sichern zwei eindeutige Teilindizes.
-- 5. Umbau `geraet_kopplung_ereignis`: Ereignisse `bestaetigt`, `abgelehnt`, `abgemeldet`.
--
-- SQLite ändert einen Tabellen-CHECK nur per Rebuild, und geraet_kopplung ist kein Leaf:
--   geraet_kopplungscode.kopplung_id      (PRIMARY KEY, ON DELETE CASCADE)
--   geraet_kopplung_ereignis.kopplung_id  (NOT NULL, ON DELETE CASCADE)
--   session.kopplung_id                   (ON DELETE CASCADE)
-- Deshalb `-- no-transaction` und PRAGMA foreign_keys = OFF (Muster 0286, migrations/AGENTS.md);
-- `db::migrate` rahmt die Migration trotzdem in eine Transaktion. Die ids bleiben 1:1, sodass alle
-- Kind-FKs nach dem RENAME weiter auflösen. Schema = 0286 1:1 plus die neuen Spalten am Ende.
-- Abgesichert von db::tests::migration_0376_*.

PRAGMA foreign_keys = OFF;

-- 1. Org-Schalter ---------------------------------------------------------------------------

ALTER TABLE org_einstellungen ADD COLUMN ortung_im_einsatz INTEGER NOT NULL DEFAULT 0;
ALTER TABLE org_einstellungen ADD COLUMN ortung_personen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE org_einstellungen ADD COLUMN ortung_bestaetigt_von INTEGER REFERENCES benutzer(id);
ALTER TABLE org_einstellungen ADD COLUMN ortung_bestaetigt_at TEXT;

-- 2. Positionsbaustein ----------------------------------------------------------------------

ALTER TABLE einsatz_einheit ADD COLUMN position_aktualisiert_at TEXT;
ALTER TABLE einsatz_einheit ADD COLUMN position_quelle TEXT
    CHECK (position_quelle IN ('manuell', 'einwurf', 'helfer'));
ALTER TABLE einsatz_fahrzeug ADD COLUMN position_aktualisiert_at TEXT;
ALTER TABLE einsatz_fahrzeug ADD COLUMN position_quelle TEXT
    CHECK (position_quelle IN ('manuell', 'einwurf', 'helfer'));
ALTER TABLE einsatz_personal ADD COLUMN position_aktualisiert_at TEXT;
ALTER TABLE einsatz_personal ADD COLUMN position_quelle TEXT
    CHECK (position_quelle IN ('manuell', 'einwurf', 'helfer'));

-- Die drei Tabellen sind gespiegelt: am Spiegel bricht ihr Schutz-Trigger jedes UPDATE ab, außer
-- unter dem Merker `spiegel_uebernahme` (wie `instanz::spiegel::uebernehmen`). Die Log-Trigger
-- schreiben die Zeilen ins Änderungslog; der Führer schickt sie mit der Quelle einmal neu.
INSERT OR IGNORE INTO spiegel_uebernahme (id) VALUES (1);
UPDATE einsatz_einheit SET position_quelle = 'manuell' WHERE lat IS NOT NULL;
UPDATE einsatz_fahrzeug SET position_quelle = 'manuell' WHERE lat IS NOT NULL;
UPDATE einsatz_personal SET position_quelle = 'manuell' WHERE lat IS NOT NULL;
DELETE FROM spiegel_uebernahme;

-- 3. Helfer-Einladung -----------------------------------------------------------------------

CREATE TABLE helfer_einladung (
    id            INTEGER PRIMARY KEY,
    einsatz_id    INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    code_hash     TEXT    NOT NULL UNIQUE,
    laeuft_ab_at  TEXT    NOT NULL,
    widerrufen_at TEXT,
    erstellt_von  INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at   TEXT    NOT NULL,
    einloesungen  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_helfer_einladung_einsatz ON helfer_einladung (einsatz_id);

-- 4. Umbau geraet_kopplung ------------------------------------------------------------------

CREATE TABLE geraet_kopplung_neu (
    id                     INTEGER PRIMARY KEY,
    einsatz_id             INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    benutzer_id            INTEGER NOT NULL UNIQUE REFERENCES benutzer(id),
    ansicht                TEXT    NOT NULL CHECK (ansicht IN (
                               'uhs-tablet', 'uhs-laptop', 'lagemonitor', 'betreuungsstelle',
                               'bereitstellungsraum', 'einsatzabschnitt', 'verpflegung',
                               'einheit', 'helfer')),
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
    -- Helfer-App: nur bei ansicht = 'helfer' gesetzt (CHECK unten).
    helfer_zustand         TEXT    CHECK (helfer_zustand IN ('unbestaetigt', 'aktiv', 'abgelehnt')),
    einladung_id           INTEGER REFERENCES helfer_einladung(id) ON DELETE SET NULL,
    anzeigename            TEXT,                         -- Name, den die Kraft eingibt
    -- Ziel neben einheit_id: ein Fahrzeug.
    fahrzeug_id            INTEGER REFERENCES einsatz_fahrzeug(id) ON DELETE SET NULL,
    -- Zugeordnete Person (nur mit Org-Schalter „Auch Personen orten“).
    person_id              INTEGER REFERENCES einsatz_personal(id) ON DELETE SET NULL,
    person_gewuenscht      INTEGER NOT NULL DEFAULT 0,   -- Kraft hat „als Person orten“ gewählt
    ortungsgeraet          INTEGER NOT NULL DEFAULT 0,   -- schreibt die Position des Ziels
    pausiert_at            TEXT,
    bestaetigt_at          TEXT,
    bestaetigt_von         INTEGER REFERENCES benutzer(id),
    CHECK ((uhs_id IS NOT NULL) + (betreuungsstelle_id IS NOT NULL)
           + (bereitstellungsraum_id IS NOT NULL) + (abschnitt_id IS NOT NULL)
           + (verpflegungsstelle_id IS NOT NULL) + (einheit_id IS NOT NULL) <= 1),
    CHECK ((einheit_id IS NOT NULL) + (fahrzeug_id IS NOT NULL) <= 1),
    CHECK ((ansicht = 'helfer') = (helfer_zustand IS NOT NULL))
);

INSERT INTO geraet_kopplung_neu
    (id, einsatz_id, benutzer_id, ansicht, uhs_id, bezeichnung, erstellt_von, erstellt_at,
     laeuft_ab_at, gekoppelt_at, letzter_zugriff_at, widerrufen_at, widerrufen_von,
     betreuungsstelle_id, bereitstellungsraum_id, abschnitt_id, verpflegungsstelle_id,
     einheit_id)
    SELECT id, einsatz_id, benutzer_id, ansicht, uhs_id, bezeichnung, erstellt_von, erstellt_at,
           laeuft_ab_at, gekoppelt_at, letzter_zugriff_at, widerrufen_at, widerrufen_von,
           betreuungsstelle_id, bereitstellungsraum_id, abschnitt_id, verpflegungsstelle_id,
           einheit_id
    FROM geraet_kopplung;

DROP TABLE geraet_kopplung;

ALTER TABLE geraet_kopplung_neu RENAME TO geraet_kopplung;

CREATE INDEX idx_geraet_kopplung_einsatz ON geraet_kopplung (einsatz_id);
CREATE INDEX idx_geraet_kopplung_abschnitt ON geraet_kopplung (abschnitt_id);
CREATE INDEX idx_geraet_kopplung_einheit ON geraet_kopplung (einheit_id);
CREATE INDEX idx_geraet_kopplung_fahrzeug ON geraet_kopplung (fahrzeug_id);
CREATE INDEX idx_geraet_kopplung_person ON geraet_kopplung (person_id);
CREATE INDEX idx_geraet_kopplung_einladung ON geraet_kopplung (einladung_id);
CREATE UNIQUE INDEX ux_helfer_ortung_einheit ON geraet_kopplung (einheit_id)
    WHERE ansicht = 'helfer' AND ortungsgeraet = 1 AND widerrufen_at IS NULL;
CREATE UNIQUE INDEX ux_helfer_ortung_fahrzeug ON geraet_kopplung (fahrzeug_id)
    WHERE ansicht = 'helfer' AND ortungsgeraet = 1 AND widerrufen_at IS NULL;

-- 5. Umbau geraet_kopplung_ereignis (Blatt; Schema = 0147 plus drei Ereignisse) -------------

CREATE TABLE geraet_kopplung_ereignis_neu (
    id          INTEGER PRIMARY KEY,
    kopplung_id INTEGER NOT NULL REFERENCES geraet_kopplung(id) ON DELETE CASCADE,
    ereignis    TEXT    NOT NULL CHECK (ereignis IN ('angelegt', 'code_ausgestellt', 'eingeloest',
                                                     'verlaengert', 'widerrufen', 'bestaetigt',
                                                     'abgelehnt', 'abgemeldet')),
    von         INTEGER REFERENCES benutzer(id),      -- handelnde Person; NULL beim Einlösen
    peer_ip     TEXT,
    zeitpunkt   TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO geraet_kopplung_ereignis_neu (id, kopplung_id, ereignis, von, peer_ip, zeitpunkt)
    SELECT id, kopplung_id, ereignis, von, peer_ip, zeitpunkt FROM geraet_kopplung_ereignis;

DROP TABLE geraet_kopplung_ereignis;

ALTER TABLE geraet_kopplung_ereignis_neu RENAME TO geraet_kopplung_ereignis;

CREATE INDEX idx_geraet_kopplung_ereignis ON geraet_kopplung_ereignis (kopplung_id, zeitpunkt);

PRAGMA foreign_keys = ON;
