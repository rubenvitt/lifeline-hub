-- LLH-1051: Lageplan als Bild-Anlage an Lagebericht und Befehl. Zweiter Anwender der Anlagen aus
-- 0157 (LFH-1028): die Lagekarte nimmt ihren Ausschnitt im Browser als PNG auf (Maßstab,
-- Nordpfeil, Legende im Bild) und legt ihn über denselben Weg ab wie die Fernmeldeskizze. Neu ist
-- nur die Art `lageplan` im CHECK beider Linker; ihre Liste spiegelt
-- `vorlagendokument::anlage::AnlageArt`.
--
-- SQLite ändert einen CHECK nur per Neubau. Beide Linker sind Blätter (keine Tabelle verweist
-- darauf; `grep -l '_anlage' migrations/*.sql`: nur 0157), ohne AUTOINCREMENT, Trigger und Views
-- → kein PRAGMA-foreign_keys-Umschalter, das DROP löst keine Kaskade aus. Muster 0214: neue
-- Tabelle, Zeilen 1:1 mit ihren ids, alte weg, umbenennen, Index wortgleich neu. Schema = 0157
-- 1:1, geändert ist nur der CHECK auf `art`. Die Tabellennamen bleiben, damit
-- `anhang::repo::MODUL_LINKER` und das Schwärzungs-Register weiter greifen. Abgesichert von
-- db::tests::migration_0227_baut_die_anlagen_linker_mit_der_art_lageplan_neu.
CREATE TABLE lagebericht_anlage_neu (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    lagebericht_id  INTEGER NOT NULL REFERENCES lagebericht(id) ON DELETE CASCADE,
    anhang_id       INTEGER NOT NULL UNIQUE REFERENCES anhang(id) ON DELETE CASCADE,
    art             TEXT    NOT NULL CHECK (art IN ('fernmeldeskizze', 'lageplan')),
    titel           TEXT    NOT NULL,
    stand_at        TEXT    NOT NULL,
    reihenfolge     INTEGER NOT NULL,
    abgelegt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    abgelegt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (lagebericht_id, reihenfolge)
);

INSERT INTO lagebericht_anlage_neu
    (id, einsatz_id, lagebericht_id, anhang_id, art, titel, stand_at, reihenfolge,
     abgelegt_von_id, abgelegt_at)
    SELECT id, einsatz_id, lagebericht_id, anhang_id, art, titel, stand_at, reihenfolge,
           abgelegt_von_id, abgelegt_at
    FROM lagebericht_anlage
    ORDER BY id;

DROP TABLE lagebericht_anlage;

ALTER TABLE lagebericht_anlage_neu RENAME TO lagebericht_anlage;

-- Der Index aus 0157 fiel mit dem DROP; wortgleich neu.
CREATE INDEX idx_lagebericht_anlage_einsatz ON lagebericht_anlage(einsatz_id);

CREATE TABLE befehl_anlage_neu (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    befehl_id       INTEGER NOT NULL REFERENCES befehl(id) ON DELETE CASCADE,
    anhang_id       INTEGER NOT NULL UNIQUE REFERENCES anhang(id) ON DELETE CASCADE,
    art             TEXT    NOT NULL CHECK (art IN ('fernmeldeskizze', 'lageplan')),
    titel           TEXT    NOT NULL,
    stand_at        TEXT    NOT NULL,
    reihenfolge     INTEGER NOT NULL,
    abgelegt_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    abgelegt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (befehl_id, reihenfolge)
);

INSERT INTO befehl_anlage_neu
    (id, einsatz_id, befehl_id, anhang_id, art, titel, stand_at, reihenfolge, abgelegt_von_id,
     abgelegt_at)
    SELECT id, einsatz_id, befehl_id, anhang_id, art, titel, stand_at, reihenfolge,
           abgelegt_von_id, abgelegt_at
    FROM befehl_anlage
    ORDER BY id;

DROP TABLE befehl_anlage;

ALTER TABLE befehl_anlage_neu RENAME TO befehl_anlage;

CREATE INDEX idx_befehl_anlage_einsatz ON befehl_anlage(einsatz_id);
