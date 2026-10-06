-- LFH-936: die Bytes der Karten-Hintergrundbilder in eine eigene Tabelle auslagern.
--
-- In 0075 steht `daten BLOB` an vierter Stelle, alle Metadaten dahinter (und `ansicht_id` aus 0096
-- am Ende). Ein Bild bis 25 MiB liegt fast ganz in Überlaufseiten; ohne `auto_vacuum` liest
-- SQLite die ganze Überlaufkette, um eine Spalte hinter dem BLOB zu erreichen. Liste, 304-Pfad und
-- `MAX(reihenfolge)` lasen so jedes Mal alle Bilder von der Platte. Nach dem Umbau trägt
-- `karte_hintergrundbild` nur Metadaten, die Bytes liegen 1:1 in `karte_hintergrundbild_daten`.
-- „BLOB als letzte Spalte“ ist verworfen: jede künftige `ADD COLUMN` landete wieder dahinter.
--
-- Rebuild in EINER Transaktion, ohne `PRAGMA foreign_keys` umzuschalten (das wirkt in einer
-- Transaktion nicht): erst die neue Metadaten-Tabelle, dann `karte_hintergrundbild_daten` mit
-- Verweis auf DIESE Tabelle, dann die Bytes kopieren. Das DROP der alten Tabelle trifft so keinen
-- Verweis (nichts verweist auf sie), und das RENAME schreibt den Verweis in
-- `karte_hintergrundbild_daten` auf den endgültigen Namen um. Bricht der Lauf ab, rollt alles zurück.
-- Die ids bleiben 1:1. Ohne AUTOINCREMENT (wie 0075) gibt es keinen sqlite_sequence-Eintrag.
--
-- Betrieb: bei großen Bestandsdaten braucht der Lauf einmalig Zeit und vorübergehend den doppelten
-- Plattenplatz der Bilder (die Bytes stehen kurz in beiden Tabellen; `secure_delete` nullt danach
-- die alten Seiten).
-- Abgesichert von db::tests::migration_0154_* (Bytes und sha256 bleiben gleich, Schema, FK).

-- Schema = 0075 + ansicht_id (0096), ohne `daten`.
CREATE TABLE karte_hintergrundbild_neu (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    name            TEXT    NOT NULL,
    mime            TEXT    NOT NULL,
    groesse         INTEGER NOT NULL,
    sha256          TEXT    NOT NULL,
    ecken_json      TEXT    NOT NULL,
    opazitaet       INTEGER NOT NULL DEFAULT 100 CHECK (opazitaet BETWEEN 0 AND 100),
    sichtbar        INTEGER NOT NULL DEFAULT 1   CHECK (sichtbar IN (0, 1)),
    reihenfolge     INTEGER NOT NULL DEFAULT 0,
    hochgeladen_von INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    geaendert_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    ansicht_id      INTEGER REFERENCES karten_ansicht(id) ON DELETE SET NULL
);

INSERT INTO karte_hintergrundbild_neu
    (id, einsatz_id, name, mime, groesse, sha256, ecken_json, opazitaet, sichtbar, reihenfolge,
     hochgeladen_von, erstellt_at, geaendert_at, ansicht_id)
    SELECT id, einsatz_id, name, mime, groesse, sha256, ecken_json, opazitaet, sichtbar,
           reihenfolge, hochgeladen_von, erstellt_at, geaendert_at, ansicht_id
    FROM karte_hintergrundbild;

-- Verweist zunächst auf `_neu`; das RENAME unten zieht den Verweis auf den endgültigen Namen nach.
CREATE TABLE karte_hintergrundbild_daten (
    bild_id INTEGER PRIMARY KEY REFERENCES karte_hintergrundbild_neu(id) ON DELETE CASCADE,
    daten   BLOB    NOT NULL
);

INSERT INTO karte_hintergrundbild_daten (bild_id, daten)
    SELECT id, daten FROM karte_hintergrundbild;

DROP TABLE karte_hintergrundbild;

ALTER TABLE karte_hintergrundbild_neu RENAME TO karte_hintergrundbild;

CREATE INDEX idx_karte_hintergrundbild_einsatz ON karte_hintergrundbild(einsatz_id);
