-- no-transaction
-- LLH-1332: Wer einen Patienten transportiert und wann ein Eigentransport übergeben ist
-- (Change y4l621ih-patientenverbleib-uebergabe, design.md D1/D2).
--
-- person_verbleib bekommt
--   transport_durch      'fremd' | 'eigen', nur bei art = 'transport' (der Handler prüft die
--                        Paarung mit 422; NULL bei Bestand heißt fremd, wie bisher abgeschlossen)
--   einsatz_fahrzeug_id  Disposition des Fahrzeugs eines Eigentransports
-- und der Status 'uebergeben' (quittierte Übergabe eines Eigentransports).
--
-- SQLite ändert einen Spalten-CHECK nur per Rebuild. person_verbleib ist Leaf (keine Tabelle
-- verweist darauf, gemessen per grep über migrations/) → kein PRAGMA-foreign_keys-Toggle, das
-- DROP löst keine Kaskade aus (Muster 0112). AUTOINCREMENT → der sqlite_sequence-Eintrag wird
-- umgehängt. Schema = 0112 plus die ADD COLUMNs aus 0121, 0165 und 0217, dann die neuen Spalten.
-- einsatz_fahrzeug war schon Nicht-Leaf (0048, 0089, 0197, 0216); ON DELETE SET NULL wie dort.
-- Abgesichert von db::tests::migration_0222_*.

CREATE TABLE person_verbleib_neu (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    person_id      INTEGER NOT NULL REFERENCES einsatz_person(id),
    art            TEXT    NOT NULL
                   CHECK (art IN ('transport','entlassung','vor_ort','verstorben','notunterkunft')),
    transportmittel TEXT,                     -- Freitext bzw. Funkrufname (Momentaufnahme)
    ziel           TEXT,                      -- Freitext-Krankenhaus/Ziel, optional
    status         TEXT
                   CHECK (status IS NULL OR status IN ('angemeldet','abtransportiert','uebergeben')),
    notiz          TEXT,
    zeitpunkt_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    erfasst_von    INTEGER NOT NULL REFERENCES benutzer(id),
    betreuungsstelle_id INTEGER REFERENCES betreuungsstelle(id) ON DELETE SET NULL,
    bestaetigt_personal_id INTEGER REFERENCES einsatz_personal(id) ON DELETE SET NULL,
    bestaetigt_name TEXT,
    client_id      TEXT,
    eingegangen_at TEXT,
    transport_durch TEXT
                   CHECK (transport_durch IS NULL OR transport_durch IN ('fremd','eigen')),
    einsatz_fahrzeug_id INTEGER REFERENCES einsatz_fahrzeug(id) ON DELETE SET NULL
);

INSERT INTO person_verbleib_neu
    (id, einsatz_id, person_id, art, transportmittel, ziel, status, notiz, zeitpunkt_at,
     erfasst_von, betreuungsstelle_id, bestaetigt_personal_id, bestaetigt_name, client_id,
     eingegangen_at)
    SELECT id, einsatz_id, person_id, art, transportmittel, ziel, status, notiz, zeitpunkt_at,
           erfasst_von, betreuungsstelle_id, bestaetigt_personal_id, bestaetigt_name, client_id,
           eingegangen_at
    FROM person_verbleib;

-- Sequenz der Alt-Tabelle übernehmen, bevor DROP ihren Eintrag entfernt (Begründung in 0112).
DELETE FROM sqlite_sequence
 WHERE name = 'person_verbleib_neu'
   AND EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'person_verbleib');
INSERT INTO sqlite_sequence (name, seq)
    SELECT 'person_verbleib_neu', seq FROM sqlite_sequence WHERE name = 'person_verbleib';

DROP TABLE person_verbleib;

ALTER TABLE person_verbleib_neu RENAME TO person_verbleib;

-- No-op, falls SQLite den Eintrag beim RENAME bereits mitzieht (wie in 0082).
UPDATE sqlite_sequence SET name = 'person_verbleib' WHERE name = 'person_verbleib_neu';

CREATE INDEX idx_person_verbleib_person ON person_verbleib (person_id, zeitpunkt_at);
CREATE UNIQUE INDEX idx_person_verbleib_client_id
    ON person_verbleib(einsatz_id, client_id)
    WHERE client_id IS NOT NULL;

-- Cache des jüngsten Verbleibs, gepflegt in derselben Anweisung wie die übrigen Verbleib-Caches
-- (verbleib_repo::erfassen_tx). Kein Backfill nötig: Bestand trägt keine Fahrer-Angabe.
ALTER TABLE einsatz_person ADD COLUMN aktueller_transport_durch TEXT;
ALTER TABLE einsatz_person ADD COLUMN aktuelles_einsatz_fahrzeug_id INTEGER
    REFERENCES einsatz_fahrzeug(id) ON DELETE SET NULL;
