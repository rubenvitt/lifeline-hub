-- Aufbewahrungsfristen je Datenkategorie (LFH-749, Spec `aufbewahrung-kategorien`).
-- Herleitung: openspec/changes/archive/2026-10-02-lfh-749-fristen-je-datenkategorie/design.md, D4.
--
-- kategorie: Wire-Wert von `einsatz::retention::Datenkategorie`. Validiert in Rust, kein
--   CHECK (sqlx-sqlite kann CHECK nicht per Rebuild ändern, vgl. 0069) — eine neue Kategorie
--   bleibt so eine reine Code-Änderung.

-- Org-Vorgabe: Dauer (0..=3650 Tage, in Rust validiert) und Rechtsgrundlage je Kategorie. Eine
-- Zeile gibt es nur bei gesetzter Dauer; fehlt sie, folgt die Kategorie der Einsatz-Frist.
CREATE TABLE org_aufbewahrung_kategorie (
    org_id          INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    kategorie       TEXT    NOT NULL,
    dauer_tage      INTEGER NOT NULL,
    rechtsgrundlage TEXT    NOT NULL,
    geaendert_at    TEXT    NOT NULL,
    geaendert_von   INTEGER REFERENCES benutzer(id),
    PRIMARY KEY (org_id, kategorie)
);

-- Kategorie-Frist am Einsatz: entsteht beim Abschluss aus der Org-Vorgabe (Rechtsgrundlage als
-- Kopie, damit ETB und Archivakte stabil bleiben) oder per manueller Frist. frist_bis NULL =
-- aufgehoben (folgt der Einsatz-Frist). vorgemerkt_at = Karenz-Start, geschwaerzt_at =
-- Tombstone der Kategorie-Schwärzung (Idempotenz-Guard, irreversibel).
CREATE TABLE einsatz_aufbewahrung_kategorie (
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    kategorie       TEXT    NOT NULL,
    frist_bis       TEXT,
    rechtsgrundlage TEXT    NOT NULL,
    vorgemerkt_at   TEXT,
    geschwaerzt_at  TEXT,
    PRIMARY KEY (einsatz_id, kategorie)
);

CREATE INDEX idx_einsatz_aufbewahrung_kategorie_frist
    ON einsatz_aufbewahrung_kategorie (frist_bis)
    WHERE geschwaerzt_at IS NULL;
