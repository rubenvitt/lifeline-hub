-- no-transaction
-- LLH-1647: Führungsakte bei Verwahrung (Entwurf E1–E4, mit Ruben am 11.11.2026 abgestimmt).
-- Neue Art des Führungswechsels `verwahrung`: Nimmt der Hub einen Einsatz nach der Nachbereitung
-- zur Verwahrung an (LLH-1494, `instanz::spiegel::lebensende::umwandeln`), vergibt er die nächste
-- Epoche und führt ab da. Wire-Wert: `instanz::fuehrung::FuehrungWechselArt::Verwahrung`
-- (Guard: tests/enum_wire_kontrakt.rs).
--
-- SQLite ändert einen CHECK nur per Neubau. `einsatz_fuehrung` ist kein Blatt:
--   einsatz_fuehrung_verlauf.fuehrung_id (NOT NULL, ON DELETE CASCADE)
-- Ein DROP TABLE mit eingeschalteten Fremdschlüsseln löschte über die Kaskade den ganzen Verlauf.
-- Deshalb `-- no-transaction` und PRAGMA foreign_keys = OFF (Muster 0286). Die ids bleiben 1:1.
-- Schema = 0316 plus die Spalten aus 0321, nur der CHECK auf `art` kennt `verwahrung` dazu.
-- Abgesichert von db::tests::migration_0325_fuehrung_verwahrung.

PRAGMA foreign_keys = OFF;

CREATE TABLE einsatz_fuehrung_neu (
    id                   INTEGER PRIMARY KEY,
    -- `<Instanzkennung des Ursprungs>/<Einsatz-ID dort>`.
    kennung              TEXT    NOT NULL UNIQUE,
    einsatz_id           INTEGER UNIQUE REFERENCES einsatz(id) ON DELETE CASCADE,
    -- Lokale Org der Akte.
    org_id               INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    -- Kopf für die Anzeige beim Gegenüber.
    nummer               TEXT,
    bezeichnung          TEXT    NOT NULL,
    stichwort            TEXT,
    status               TEXT    NOT NULL CHECK (status IN ('aktiv', 'abgeschlossen')),
    epoche_zaehler       INTEGER NOT NULL CHECK (epoche_zaehler >= 1),
    epoche_instanz       TEXT    NOT NULL,
    fuehrer_kennung      TEXT    NOT NULL,
    fuehrer_name         TEXT    NOT NULL,
    -- Art des letzten Wechsels (Wire-Werte von `FuehrungWechselArt`).
    art                  TEXT    NOT NULL CHECK (art IN ('angelegt', 'uebergabe', 'anfrage',
                             'notuebernahme', 'code_abgabe', 'bestaetigt', 'widerspruch',
                             'verworfen', 'verwahrung')),
    -- Erklärung und Beweis der Notübernahme, mit der die geltende Epoche kam (D6, D8).
    erklaerung           TEXT,
    beweis               TEXT,
    offen                TEXT,
    offen_bruch_at       TEXT,
    abgabe_schluessel    TEXT,
    -- Meldende Seite: Übernahme beim Gegenüber erbeten (D9).
    anfrage_at           TEXT,
    bruch_at             TEXT,
    stand                INTEGER NOT NULL,
    geaendert_at         TEXT    NOT NULL,
    -- 0321 (LLH-1641): Herkunft der Zeilen, Stand bei der Übernahme, wartende Anfrage.
    herkunft_kopplung_id INTEGER REFERENCES instanz_kopplung(id) ON DELETE SET NULL,
    uebernommen_stand    INTEGER,
    anfrage_von          TEXT,
    CHECK ((offen IS NULL) = (offen_bruch_at IS NULL))
);

INSERT INTO einsatz_fuehrung_neu
    (id, kennung, einsatz_id, org_id, nummer, bezeichnung, stichwort, status, epoche_zaehler,
     epoche_instanz, fuehrer_kennung, fuehrer_name, art, erklaerung, beweis, offen,
     offen_bruch_at, abgabe_schluessel, anfrage_at, bruch_at, stand, geaendert_at,
     herkunft_kopplung_id, uebernommen_stand, anfrage_von)
    SELECT id, kennung, einsatz_id, org_id, nummer, bezeichnung, stichwort, status,
           epoche_zaehler, epoche_instanz, fuehrer_kennung, fuehrer_name, art, erklaerung,
           beweis, offen, offen_bruch_at, abgabe_schluessel, anfrage_at, bruch_at, stand,
           geaendert_at, herkunft_kopplung_id, uebernommen_stand, anfrage_von
    FROM einsatz_fuehrung;

DROP TABLE einsatz_fuehrung;
ALTER TABLE einsatz_fuehrung_neu RENAME TO einsatz_fuehrung;

CREATE INDEX idx_einsatz_fuehrung_org ON einsatz_fuehrung(org_id);
CREATE INDEX idx_einsatz_fuehrung_stand ON einsatz_fuehrung(stand);

-- Der Verlauf ist Blatt; sein Verweis auf `einsatz_fuehrung` löst nach dem RENAME weiter auf.
CREATE TABLE einsatz_fuehrung_verlauf_neu (
    id             INTEGER PRIMARY KEY,
    fuehrung_id    INTEGER NOT NULL REFERENCES einsatz_fuehrung(id) ON DELETE CASCADE,
    epoche_zaehler INTEGER NOT NULL,
    epoche_instanz TEXT    NOT NULL,
    art            TEXT    NOT NULL CHECK (art IN ('angelegt', 'uebergabe', 'anfrage',
                       'notuebernahme', 'code_abgabe', 'bestaetigt', 'widerspruch',
                       'verworfen', 'verwahrung')),
    von_name       TEXT,
    nach_name      TEXT    NOT NULL,
    -- Handelnde Person (Name als Schnappschuss) oder NULL, wenn das Gegenüber auslöste.
    wer            TEXT,
    grund          TEXT,
    unterzeichner  TEXT,
    bruch_at       TEXT,
    at             TEXT    NOT NULL
);

INSERT INTO einsatz_fuehrung_verlauf_neu
    (id, fuehrung_id, epoche_zaehler, epoche_instanz, art, von_name, nach_name, wer, grund,
     unterzeichner, bruch_at, at)
    SELECT id, fuehrung_id, epoche_zaehler, epoche_instanz, art, von_name, nach_name, wer, grund,
           unterzeichner, bruch_at, at
    FROM einsatz_fuehrung_verlauf;

DROP TABLE einsatz_fuehrung_verlauf;
ALTER TABLE einsatz_fuehrung_verlauf_neu RENAME TO einsatz_fuehrung_verlauf;

CREATE INDEX idx_einsatz_fuehrung_verlauf ON einsatz_fuehrung_verlauf(fuehrung_id, id);

PRAGMA foreign_keys = ON;
