-- LFH-999: Plan bzw. Grundriss einer UHS als Hintergrundbild unter dem Platz-Layout.
-- Höchstens ein Plan je UHS (uhs_id ist der Schlüssel). KEIN Anhang: eigene, bereinigte Bytes
-- (ohne Metadaten), kein FK auf `anhang` — die Übernahme aus einem UHS-Anhang kopiert. Die
-- Anzeige schreibt kein Lese-Audit (Herleitung openspec/changes/…/lfh-999-uhs-plan-hintergrund/
-- design.md, D1). Schwärzung: `ZeileLoeschen` (einsatz/schwaerzung_registry.rs).
-- Lage in Koordinaten der Platzfläche (wie uhs_platz.pos_x/pos_y), Höhe aus dem Seitenverhältnis.
CREATE TABLE uhs_plan (
    uhs_id          INTEGER PRIMARY KEY REFERENCES uhs(id) ON DELETE CASCADE,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    daten           BLOB    NOT NULL,
    mime            TEXT    NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
    groesse         INTEGER NOT NULL,
    sha256          TEXT    NOT NULL,
    bild_breite     INTEGER NOT NULL CHECK (bild_breite > 0),
    bild_hoehe      INTEGER NOT NULL CHECK (bild_hoehe > 0),
    x               INTEGER NOT NULL DEFAULT 0 CHECK (x BETWEEN 0 AND 10000),
    y               INTEGER NOT NULL DEFAULT 0 CHECK (y BETWEEN 0 AND 10000),
    breite          INTEGER NOT NULL CHECK (breite BETWEEN 100 AND 5000),
    helligkeit      INTEGER NOT NULL DEFAULT 100 CHECK (helligkeit BETWEEN 20 AND 100),
    kontrast        INTEGER NOT NULL DEFAULT 100 CHECK (kontrast BETWEEN 50 AND 150),
    nacht_umkehren  INTEGER NOT NULL DEFAULT 1 CHECK (nacht_umkehren IN (0, 1)),
    hinterlegt_von  INTEGER NOT NULL REFERENCES benutzer(id),
    hinterlegt_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
    geaendert_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
);
CREATE INDEX idx_uhs_plan_einsatz ON uhs_plan(einsatz_id);
