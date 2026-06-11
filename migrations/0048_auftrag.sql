-- Aufträge/Befehle (LFH-52): MVP-Kern der aktiven Führung (FwDV/DV 100).
-- Befehlsschema + getrennte Achsen: Quittung PRO EMPFÄNGER (auftrag_empfaenger),
-- Vollzug PRO AUFTRAG über den geteilten kommunikation_status (LFH-84).
-- ETB-Kopplung (Pattern B): Auftrag→Anordnung, Vollzugsmeldung→Meldung via auftrag_id.
CREATE TABLE auftrag (
    id                INTEGER PRIMARY KEY,
    einsatz_id        INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    -- Befehlsschema (FwDV 100): auftrag_text = Auftrag/Was (Pflicht), Rest optional.
    auftrag_text      TEXT    NOT NULL,
    absicht           TEXT,   -- Absicht/Ziel (Auftragstaktik)
    lage              TEXT,   -- Lage(-bezug)
    ort               TEXT,   -- Ort/Wo
    zeit              TEXT,   -- Zeit/Wann (Freitext)
    mittel            TEXT,   -- Mittel/Womit
    verbindung        TEXT,   -- Verbindung/Meldewege
    sicherheit        TEXT,   -- Sicherheit/Besonderes
    -- 'sofort' | 'dringend' | 'normal' (Code-validiert, kein DB-CHECK).
    prioritaet        TEXT    NOT NULL DEFAULT 'normal',
    -- Quittungs-/Vollzugsfrist (UTC 'YYYY-MM-DD HH:MM:SS'), optional.
    frist_at          TEXT,
    -- Ereigniszeit: wann der Befehl tatsächlich erteilt wurde (≠ Erfassungszeit).
    erteilt_at        TEXT    NOT NULL,
    -- Zeitstempel der Stufen, die kommunikation_status nicht führt.
    in_arbeit_at      TEXT,
    -- Vollzugs-Rückmeldung (Text) bei Erledigung; Inhalt der ETB-Meldung.
    vollzugsmeldung   TEXT,
    -- Abnahme durch die Führung (4. Stufe nach 'vollzogen').
    abgenommen_at     TEXT,
    abgenommen_von_id INTEGER REFERENCES benutzer(id),
    -- ETB-Rückverweis auf die erzeugte Anordnung (Pattern-B-Gegenseite).
    etb_anordnung_id  INTEGER REFERENCES etb_eintrag(id),
    erstellt_von_id   INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_auftrag_einsatz ON auftrag(einsatz_id, frist_at);

-- Empfänger (1:n): EA / Einheit / Funktion(Freitext) / Person / Fahrzeug.
-- Quittung liegt PRO EMPFÄNGER (Führungskontrolle: wer hat noch nicht quittiert?).
CREATE TABLE auftrag_empfaenger (
    id               INTEGER PRIMARY KEY,
    auftrag_id       INTEGER NOT NULL REFERENCES auftrag(id) ON DELETE CASCADE,
    empfaenger_typ   TEXT    NOT NULL
                     CHECK (empfaenger_typ IN ('abschnitt','einheit','funktion','person','fahrzeug')),
    abschnitt_id     INTEGER REFERENCES einsatzabschnitt(id),
    einheit_id       INTEGER REFERENCES einsatz_einheit(id),
    person_id        INTEGER REFERENCES einsatz_personal(id),
    fahrzeug_id      INTEGER REFERENCES einsatz_fahrzeug(id),
    funktion_text    TEXT,
    -- Klarname zum Erfassungszeitpunkt (snap_*-Muster, historische Nachvollziehbarkeit).
    snap_anzeige     TEXT    NOT NULL,
    -- Quittung (Achse 1) pro Empfänger.
    quittiert_at     TEXT,
    quittiert_von_id INTEGER REFERENCES benutzer(id)
);
CREATE INDEX idx_auftrag_empfaenger_auftrag ON auftrag_empfaenger(auftrag_id);

-- ETB-Kopplung: Anordnung + Vollzugsmeldung verweisen über auftrag_id auf den
-- Auftrag (Vorlage 0038_lagebericht.sql; berührt die FTS-Trigger nicht).
ALTER TABLE etb_eintrag ADD COLUMN auftrag_id INTEGER REFERENCES auftrag(id);
