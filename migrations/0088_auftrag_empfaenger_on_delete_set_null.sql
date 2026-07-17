-- Löschstrategie (LFH-237 / F08): die vier Dispositions-FKs von auftrag_empfaenger
-- (abschnitt_id/einheit_id/person_id/fahrzeug_id) trugen keine ON-DELETE-Aktion → Default
-- NO ACTION = blockierend (foreign_keys=ON). Damit scheiterte das Hard-Delete einer
-- referenzierten Dispositions-Entität am FK und blockierte Kern-Workflows der Einsatzführung
-- dauerhaft (Einheit auflösen, Person/Fahrzeug entfernen, Abschnitt auflösen → 500).
--
-- Fix: ON DELETE SET NULL. Der Empfänger-Datensatz überlebt die Löschung; snap_anzeige
-- (NOT NULL) trägt die historische Anzeige (Klarname zum Erfassungszeitpunkt) weiter, der
-- Auftrag-Bezug (auftrag_id) und die Quittung bleiben erhalten — der Führungsnachweis bleibt
-- lückenlos, nur der Live-Rückbezug auf die gelöschte Entität entfällt (korrekt, sie ist weg).
--
-- Der CHECK auf empfaenger_typ ist per ALTER nicht änderbar → SQLite-Tabellen-Rebuild
-- (kanonische Prozedur, hier verkürzt: auf auftrag_empfaenger liegen KEINE Trigger/FTS/Views
-- und KEINE eingehenden FKs auf ihre id — nur ein Index; Präzedenz 0057).
CREATE TABLE auftrag_empfaenger_neu (
    id               INTEGER PRIMARY KEY,
    auftrag_id       INTEGER NOT NULL REFERENCES auftrag(id) ON DELETE CASCADE,
    empfaenger_typ   TEXT    NOT NULL
                     CHECK (empfaenger_typ IN ('abschnitt','einheit','funktion','person','fahrzeug','extern')),
    abschnitt_id     INTEGER REFERENCES einsatzabschnitt(id)  ON DELETE SET NULL,
    einheit_id       INTEGER REFERENCES einsatz_einheit(id)   ON DELETE SET NULL,
    person_id        INTEGER REFERENCES einsatz_personal(id)  ON DELETE SET NULL,
    fahrzeug_id      INTEGER REFERENCES einsatz_fahrzeug(id)  ON DELETE SET NULL,
    funktion_text    TEXT,
    extern_kategorie   TEXT,
    extern_bezeichnung TEXT,
    snap_anzeige     TEXT    NOT NULL,
    quittiert_at     TEXT,
    quittiert_von_id INTEGER REFERENCES benutzer(id)
);
INSERT INTO auftrag_empfaenger_neu
    (id, auftrag_id, empfaenger_typ, abschnitt_id, einheit_id, person_id, fahrzeug_id,
     funktion_text, extern_kategorie, extern_bezeichnung, snap_anzeige, quittiert_at, quittiert_von_id)
  SELECT id, auftrag_id, empfaenger_typ, abschnitt_id, einheit_id, person_id, fahrzeug_id,
         funktion_text, extern_kategorie, extern_bezeichnung, snap_anzeige, quittiert_at, quittiert_von_id
  FROM auftrag_empfaenger;
DROP TABLE auftrag_empfaenger;
ALTER TABLE auftrag_empfaenger_neu RENAME TO auftrag_empfaenger;
CREATE INDEX idx_auftrag_empfaenger_auftrag ON auftrag_empfaenger(auftrag_id);
