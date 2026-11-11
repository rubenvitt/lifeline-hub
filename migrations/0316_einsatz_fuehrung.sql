-- LLH-1491 (Change v6hj7xl2-fuehrung-epoche, design.md D1, D3, D12): Führung je Einsatz zwischen
-- gekoppelten Instanzen.
--
-- 1. `instanz_identitaet.fuehrung_an`: der Schalter `LIFELINE_FUEHRUNG`, beim Start geschrieben
--    (wie `datentraeger_bestaetigt`). In der DB statt im Prozess, damit zwei Instanzen im selben
--    Testprozess je ihren eigenen Schalter haben.
-- 2. `einsatz.fuehrung_bei`: Anzeigename der führenden Instanz, wenn eine andere führt, sonst
--    NULL. Ein Merker für die Schreibsperre (`berechtigung::fordere_aktiv`,
--    `repo::fordere_aktiv_in_tx`), den nur `instanz::fuehrung` schreibt und den der Start aus den
--    Akten neu setzt (Schalter aus → überall NULL).
-- 3. `instanz_kopplung.fuehrung_gesendet_bis`/`fuehrung_empfangen_bis`: Stände des Austauschs
--    (D3): was das Gegenüber von hier bestätigt hat, und was hier vom Gegenüber übernommen ist.
-- 4. `einsatz_fuehrung`: je Einsatz einer gekoppelten Org eine Akte (D1). `einsatz_id` ist NULL
--    für eine Akte des Gegenübers (der Einsatz liegt nicht hier). Epoche als Paar (D2). `offen`
--    trägt eine gültig bewiesene Übernahme gegen diese Instanz, die auf die Entscheidung der
--    Einsatzleitung wartet (JSON der empfangenen Akte, D7). `abgabe_schluessel` ist der aus dem
--    Abgabecode abgeleitete Schlüssel (D8), nie der Code. `stand` ist monoton je Instanz.
-- 5. `einsatz_fuehrung_verlauf`: je Wechsel eine Zeile (Spec „Jeder Führungswechsel ist
--    nachvollziehbar“).
-- 6. `benachrichtigung` mit zwei neuen Arten (Rebuild nach Muster 0255, mit den Spalten aus
--    0275 und 0282); die drei neuen
--    Aktionen der Admin-Spur stehen in 0317 (ohne Transaktion, Muster 0309).
--
-- Aufbewahrung: beide neuen Tabellen sind einsatz-scoped (`einsatz::schwaerzung_registry`).
ALTER TABLE instanz_identitaet ADD COLUMN fuehrung_an INTEGER NOT NULL DEFAULT 0
    CHECK (fuehrung_an IN (0, 1));
-- Zähler für `einsatz_fuehrung.stand`: monoton, auch wenn die Akte mit dem größten Stand mit
-- ihrem Einsatz verschwindet (sonst sähe das Gegenüber einen neuen Stand unter seiner Quittung).
ALTER TABLE instanz_identitaet ADD COLUMN fuehrung_stand INTEGER NOT NULL DEFAULT 0;

ALTER TABLE einsatz ADD COLUMN fuehrung_bei TEXT;

ALTER TABLE instanz_kopplung ADD COLUMN fuehrung_gesendet_bis INTEGER NOT NULL DEFAULT 0;
ALTER TABLE instanz_kopplung ADD COLUMN fuehrung_empfangen_bis INTEGER NOT NULL DEFAULT 0;

CREATE TABLE einsatz_fuehrung (
    id                INTEGER PRIMARY KEY,
    -- `<Instanzkennung des Ursprungs>/<Einsatz-ID dort>`.
    kennung           TEXT    NOT NULL UNIQUE,
    einsatz_id        INTEGER UNIQUE REFERENCES einsatz(id) ON DELETE CASCADE,
    -- Lokale Org der Akte.
    org_id            INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    -- Kopf für die Anzeige beim Gegenüber.
    nummer            TEXT,
    bezeichnung       TEXT    NOT NULL,
    stichwort         TEXT,
    status            TEXT    NOT NULL CHECK (status IN ('aktiv', 'abgeschlossen')),
    epoche_zaehler    INTEGER NOT NULL CHECK (epoche_zaehler >= 1),
    epoche_instanz    TEXT    NOT NULL,
    fuehrer_kennung   TEXT    NOT NULL,
    fuehrer_name      TEXT    NOT NULL,
    -- Art des letzten Wechsels (Wire-Werte von `FuehrungWechselArt`).
    art               TEXT    NOT NULL CHECK (art IN ('angelegt', 'uebergabe', 'anfrage',
                          'notuebernahme', 'code_abgabe', 'bestaetigt', 'widerspruch',
                          'verworfen')),
    -- Erklärung und Beweis der Notübernahme, mit der die geltende Epoche kam (D6, D8).
    erklaerung        TEXT,
    beweis            TEXT,
    offen             TEXT,
    offen_bruch_at    TEXT,
    abgabe_schluessel TEXT,
    -- Meldende Seite: Übernahme beim Gegenüber erbeten (D9).
    anfrage_at        TEXT,
    bruch_at          TEXT,
    stand             INTEGER NOT NULL,
    geaendert_at      TEXT    NOT NULL,
    CHECK ((offen IS NULL) = (offen_bruch_at IS NULL))
);
CREATE INDEX idx_einsatz_fuehrung_org ON einsatz_fuehrung(org_id);
CREATE INDEX idx_einsatz_fuehrung_stand ON einsatz_fuehrung(stand);

CREATE TABLE einsatz_fuehrung_verlauf (
    id             INTEGER PRIMARY KEY,
    fuehrung_id    INTEGER NOT NULL REFERENCES einsatz_fuehrung(id) ON DELETE CASCADE,
    epoche_zaehler INTEGER NOT NULL,
    epoche_instanz TEXT    NOT NULL,
    art            TEXT    NOT NULL CHECK (art IN ('angelegt', 'uebergabe', 'anfrage',
                       'notuebernahme', 'code_abgabe', 'bestaetigt', 'widerspruch',
                       'verworfen')),
    von_name       TEXT,
    nach_name      TEXT    NOT NULL,
    -- Handelnde Person (Name als Schnappschuss) oder NULL, wenn das Gegenüber auslöste.
    wer            TEXT,
    grund          TEXT,
    unterzeichner  TEXT,
    bruch_at       TEXT,
    at             TEXT    NOT NULL
);
CREATE INDEX idx_einsatz_fuehrung_verlauf ON einsatz_fuehrung_verlauf(fuehrung_id, id);

-- ── benachrichtigung: zwei neue Arten (Muster 0255) ──────────────────────────────────────────
CREATE TABLE benachrichtigung_neu (
    id           INTEGER PRIMARY KEY,
    einsatz_id   INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    benutzer_id  INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    art          TEXT    NOT NULL CHECK (art IN (
        'sofortmeldung', 'sofortmeldung_eskaliert', 'auftrag_ueberfaellig', 'abloesung_faellig',
        'erinnerung_faellig', 'abloesung_vorwarnung', 'abloesung_planung', 'abloesung_abloeser',
        'auftrag_erteilt', 'auftrag_quittiert', 'auftrag_erledigt', 'befehl', 'lagebericht',
        'meldung', 'rueckmeldung_ueberfaellig', 'lagebesprechung_vorher', 'lagebesprechung_faellig',
        'nachforderung_status', 'gefahr', 'sichtung_eins', 'vermisstenmeldung', 'wieder_verfuegbar',
        'chat_erwaehnung', 'einsatz_aufnahme', 'einsatz_neu', 'unwetter', 'fuehrung_ungueltig',
        'fuehrung_uebernommen')),
    stufe        TEXT    NOT NULL CHECK (stufe IN ('alarm', 'hinweis', 'still')),
    bezug_typ    TEXT    NOT NULL,
    bezug_id     INTEGER NOT NULL,
    ausloeser_id INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    erstellt_at  TEXT    NOT NULL,
    quittiert_at TEXT,
    -- 0275 und 0282: die gemeinte und die auslösende Einheit (ohne REFERENCES, Begründung dort).
    einheit_id       INTEGER,
    durch_einheit_id INTEGER
);

INSERT INTO benachrichtigung_neu
    (id, einsatz_id, benutzer_id, art, stufe, bezug_typ, bezug_id, ausloeser_id, erstellt_at,
     quittiert_at, einheit_id, durch_einheit_id)
    SELECT id, einsatz_id, benutzer_id, art, stufe, bezug_typ, bezug_id, ausloeser_id,
           erstellt_at, quittiert_at, einheit_id, durch_einheit_id
    FROM benachrichtigung
    ORDER BY id;

DROP TABLE benachrichtigung;

ALTER TABLE benachrichtigung_neu RENAME TO benachrichtigung;

CREATE INDEX idx_benachrichtigung_benutzer ON benachrichtigung(benutzer_id, erstellt_at);
CREATE INDEX idx_benachrichtigung_einsatz ON benachrichtigung(einsatz_id);
