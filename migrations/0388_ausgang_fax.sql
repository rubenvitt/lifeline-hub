-- LLH-2095: Ausgang per Fax (Spec docs/superpowers/specs/2026-11-25-atnsssv3-ausgang-fax-pdf-design.md,
-- Abschnitte 5 und 6).
--
-- Umbau des Blatts `ausgang` (niemand verweist darauf, deshalb ohne Marker in der Transaktion
-- von sqlx, Muster 0208): der Zustand `zugestellt` und der Fehler `nicht_zugestellt` kommen in
-- die CHECKs, dazu vier Spalten.
--   anbieter_ref        Session-ID des Fax-Anbieters (sipgate), nur bei Fax nach der Übergabe
--   zugestellt_at       wann der Anbieter die Zustellung bestätigt hat
--   naechste_abfrage_at wann der Lauf den Anbieter das nächste Mal nach dem Stand fragt
--   ohne_pdf            die Mail ging ohne PDF hinaus (PDF zu groß oder nicht erzeugbar)
-- Die Listen der CHECKs sind weiter `VersandZustand::ALLE` und `AusgangFehler::ALLE`
-- (Test `ausgang::tests::check_listen_entsprechen_den_enums`).

CREATE TABLE ausgang_neu (
    id                    TEXT PRIMARY KEY,
    org_id                INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    einsatz_id            INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    client_id             TEXT NOT NULL,
    quelle_art            TEXT NOT NULL CHECK (quelle_art IN ('lagebericht', 'befehl', 'nachforderung')),
    quelle_id             INTEGER NOT NULL,
    kanal                 TEXT NOT NULL CHECK (kanal IN ('email', 'fax', 'matrix', 'threema')),
    externe_stelle_id     INTEGER REFERENCES org_externe_stelle(id) ON DELETE SET NULL,
    stelle_bezeichnung    TEXT NOT NULL,
    adresse               TEXT NOT NULL,
    betreff               TEXT NOT NULL,
    inhalt                TEXT NOT NULL,
    zustand               TEXT NOT NULL DEFAULT 'wartet'
        CHECK (zustand IN ('wartet', 'uebergeben', 'zugestellt', 'fehlgeschlagen')),
    versuche              INTEGER NOT NULL DEFAULT 0,
    naechster_versuch_at  TEXT,
    erster_versuch_at     TEXT,
    versuch_begonnen_at   TEXT,
    fehler_art            TEXT CHECK (fehler_art IS NULL OR fehler_art IN (
        'voruebergehend', 'abgelehnt', 'ungewiss', 'ueberholt', 'anbindung_fehlt',
        'anbindung_angehalten', 'anbindung_fehler', 'zu_gross', 'spiegel', 'nicht_zugestellt')),
    fehler_status         INTEGER,
    erstellt_von_id       INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at           TEXT NOT NULL,
    uebergeben_at         TEXT,
    etb_eintrag_id        INTEGER REFERENCES etb_eintrag(id) ON DELETE SET NULL,
    anbieter_ref          TEXT,
    zugestellt_at         TEXT,
    naechste_abfrage_at   TEXT,
    ohne_pdf              INTEGER NOT NULL DEFAULT 0 CHECK (ohne_pdf IN (0, 1)),
    UNIQUE (org_id, client_id)
);

INSERT INTO ausgang_neu (
    id, org_id, einsatz_id, client_id, quelle_art, quelle_id, kanal, externe_stelle_id,
    stelle_bezeichnung, adresse, betreff, inhalt, zustand, versuche, naechster_versuch_at,
    erster_versuch_at, versuch_begonnen_at, fehler_art, fehler_status, erstellt_von_id,
    erstellt_at, uebergeben_at, etb_eintrag_id)
SELECT
    id, org_id, einsatz_id, client_id, quelle_art, quelle_id, kanal, externe_stelle_id,
    stelle_bezeichnung, adresse, betreff, inhalt, zustand, versuche, naechster_versuch_at,
    erster_versuch_at, versuch_begonnen_at, fehler_art, fehler_status, erstellt_von_id,
    erstellt_at, uebergeben_at, etb_eintrag_id
FROM ausgang;

DROP TABLE ausgang;
ALTER TABLE ausgang_neu RENAME TO ausgang;

CREATE INDEX idx_ausgang_faellig ON ausgang(zustand, naechster_versuch_at);
CREATE INDEX idx_ausgang_quelle ON ausgang(einsatz_id, quelle_art, quelle_id);
CREATE INDEX idx_ausgang_abfrage ON ausgang(naechste_abfrage_at)
    WHERE zustand = 'uebergeben' AND anbieter_ref IS NOT NULL;
