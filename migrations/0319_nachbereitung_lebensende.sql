-- LLH-1494 (Change tkky2noy-archiv-nachbereitung, design.md D1, D4, D6, D7): Nachbereitungsfrist,
-- Abräumen eines Einsatzes nach Verwahrung oder Lebensende, Löschprotokoll mit Art.

-- D1: Nachbereitung in Tagen ab Abschluss; NULL = keine. Validierung (1…3650) in Rust, wie
-- retention_dauer_tage. Verteilt mit der Stammdatenart OrgEinstellungen (Hub → ELW).
ALTER TABLE org_einstellungen ADD COLUMN nachbereitung_tage INTEGER;

-- D1: Ende der Nachbereitung (UTC, kanonisch); der Abschluss setzt es aus der Org-Vorgabe.
-- Gespiegelt wie jede Spalte des Kopfes: der Spiegel räumt danach ab (D5).
ALTER TABLE einsatz ADD COLUMN nachbereitung_bis TEXT;

-- D7: Das Löschprotokoll kennt neben dem gelöschten Skelett den verwahrten Einsatz (an die
-- Gegenstelle übergeben) und den abgeräumten Spiegel. Nur `skelett` trägt Schwärzung, Frist und
-- Akteur zwingend. Die Tabelle hat keine Trigger und keinen eingehenden Verweis.
CREATE TABLE aufbewahrung_loeschprotokoll_neu (
    id                   INTEGER PRIMARY KEY,
    org_id               INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    einsatz_id           INTEGER NOT NULL UNIQUE,
    art                  TEXT    NOT NULL DEFAULT 'skelett'
                             CHECK (art IN ('skelett', 'verwahrt', 'spiegel')),
    gegenstelle          TEXT,
    einsatznummer_intern TEXT,
    nummer_jahr          INTEGER,
    nummer_lfd           INTEGER,
    abgeschlossen_at     TEXT,
    geschwaerzt_at       TEXT,
    geloescht_at         TEXT    NOT NULL,
    skelett_dauer_tage   INTEGER,
    akteur_id            INTEGER REFERENCES benutzer(id),
    CHECK (art <> 'skelett' OR (geschwaerzt_at IS NOT NULL AND skelett_dauer_tage IS NOT NULL
                                AND akteur_id IS NOT NULL))
);

INSERT INTO aufbewahrung_loeschprotokoll_neu
    (id, org_id, einsatz_id, art, einsatznummer_intern, nummer_jahr, nummer_lfd,
     abgeschlossen_at, geschwaerzt_at, geloescht_at, skelett_dauer_tage, akteur_id)
SELECT id, org_id, einsatz_id, 'skelett', einsatznummer_intern, nummer_jahr, nummer_lfd,
       abgeschlossen_at, geschwaerzt_at, geloescht_at, skelett_dauer_tage, akteur_id
  FROM aufbewahrung_loeschprotokoll;

DROP TABLE aufbewahrung_loeschprotokoll;
ALTER TABLE aufbewahrung_loeschprotokoll_neu RENAME TO aufbewahrung_loeschprotokoll;
CREATE INDEX idx_aufbewahrung_loeschprotokoll_org ON aufbewahrung_loeschprotokoll(org_id);

-- D6: Merker „wird abgeräumt“. Gesetzt in der Transaktion, die das Abräumen beschließt
-- (Quittung der Verwahrung, Lebensende, Purge-Phase R); das Löschen selbst folgt nach dem Commit
-- und wird nach einem Absturz in Phase R nachgeholt.
CREATE TABLE einsatz_abraeumen (
    einsatz_id    INTEGER PRIMARY KEY REFERENCES einsatz(id) ON DELETE CASCADE,
    art           TEXT NOT NULL CHECK (art IN ('verwahrt', 'spiegel')),
    gegenstelle   TEXT,
    vorgemerkt_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- D4/D8: Lokaler Stand der Übergabe an die verwahrende Gegenstelle: die letzte Quittung
-- „wartet“ samt Grund, für den Hinweis im Reiter Aufbewahrung.
CREATE TABLE einsatz_verwahrung (
    einsatz_id   INTEGER PRIMARY KEY REFERENCES einsatz(id) ON DELETE CASCADE,
    gegenstelle  TEXT NOT NULL,
    grund        TEXT,
    quittiert_at TEXT NOT NULL
);
