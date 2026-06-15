-- Externer Adressat am Auftrag (LFH-87): erweitert auftrag_empfaenger.empfaenger_typ um 'extern'
-- und ergänzt strukturierte Extern-Felder. Der harte CHECK ist per ALTER nicht änderbar →
-- SQLite-Tabellen-Rebuild (kanonische 12-Schritt-Prozedur, hier verkürzt: auf auftrag_empfaenger
-- liegen KEINE Trigger/FTS/Views und KEINE eingehenden FKs auf ihre id — nur ein Index).
CREATE TABLE auftrag_empfaenger_neu (
    id               INTEGER PRIMARY KEY,
    auftrag_id       INTEGER NOT NULL REFERENCES auftrag(id) ON DELETE CASCADE,
    empfaenger_typ   TEXT    NOT NULL
                     CHECK (empfaenger_typ IN ('abschnitt','einheit','funktion','person','fahrzeug','extern')),
    abschnitt_id     INTEGER REFERENCES einsatzabschnitt(id),
    einheit_id       INTEGER REFERENCES einsatz_einheit(id),
    person_id        INTEGER REFERENCES einsatz_personal(id),
    fahrzeug_id      INTEGER REFERENCES einsatz_fahrzeug(id),
    funktion_text    TEXT,
    -- Externer Adressat (LFH-87): Kategorie code-validiert (leitstelle/nachbar_ea/uebergeordnet/
    -- andere_bos), kein CHECK; Bezeichnung Freitext.
    extern_kategorie   TEXT,
    extern_bezeichnung TEXT,
    snap_anzeige     TEXT    NOT NULL,
    quittiert_at     TEXT,
    quittiert_von_id INTEGER REFERENCES benutzer(id)
);
INSERT INTO auftrag_empfaenger_neu
    (id, auftrag_id, empfaenger_typ, abschnitt_id, einheit_id, person_id, fahrzeug_id,
     funktion_text, snap_anzeige, quittiert_at, quittiert_von_id)
  SELECT id, auftrag_id, empfaenger_typ, abschnitt_id, einheit_id, person_id, fahrzeug_id,
         funktion_text, snap_anzeige, quittiert_at, quittiert_von_id
  FROM auftrag_empfaenger;
DROP TABLE auftrag_empfaenger;
ALTER TABLE auftrag_empfaenger_neu RENAME TO auftrag_empfaenger;
CREATE INDEX idx_auftrag_empfaenger_auftrag ON auftrag_empfaenger(auftrag_id);
