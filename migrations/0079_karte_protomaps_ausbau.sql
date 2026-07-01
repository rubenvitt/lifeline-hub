-- no-transaction
-- LFH-196: Protomaps als Online-Quellentyp wieder entfernen.
-- Schränkt CHECK (typ IN ('vektor', 'raster', 'protomaps')) auf ('vektor', 'raster') ein.
-- Bestehende protomaps-Zeilen zuerst löschen (Karten-Rebuild verwirft Protomaps, LFH-195).
--
-- Nicht-Leaf-CHECK-Rebuild (karte_proxy_asset → karte_online_quelle via FK ON DELETE CASCADE):
-- Benötigt PRAGMA foreign_keys = OFF während des Rebuilds (DROP würde sonst CASCADE auslösen).
-- Mit sqlx 0.9 und der `-- no-transaction`-Direktive (muss am Datei-ANFANG stehen) wird die
-- Migration OHNE Transaktion ausgeführt, sodass PRAGMA foreign_keys = OFF wirkt (innerhalb
-- einer Transaktion ist es ein No-op in SQLite).

PRAGMA foreign_keys = OFF;

DELETE FROM karte_online_quelle WHERE typ = 'protomaps';

CREATE TABLE karte_online_quelle_new (
    id           INTEGER PRIMARY KEY,
    name         TEXT    NOT NULL,
    url          TEXT    NOT NULL,
    typ          TEXT    NOT NULL DEFAULT 'vektor' CHECK (typ IN ('vektor', 'raster')),
    attribution  TEXT,
    sortier      INTEGER NOT NULL DEFAULT 0,
    aktiv        INTEGER NOT NULL DEFAULT 1 CHECK (aktiv IN (0, 1)),
    erstellt_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    geaendert_at TEXT    NOT NULL DEFAULT (datetime('now')),
    proxy        INTEGER NOT NULL DEFAULT 0 CHECK (proxy IN (0, 1))
);

INSERT INTO karte_online_quelle_new
    SELECT id, name, url, typ, attribution, sortier, aktiv, erstellt_at, geaendert_at, proxy
    FROM karte_online_quelle;

DROP TABLE karte_online_quelle;

ALTER TABLE karte_online_quelle_new RENAME TO karte_online_quelle;

PRAGMA foreign_keys = ON;
