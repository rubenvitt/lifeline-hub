-- Nachforderung von Kräften/Mitteln (LFH-87): strukturierte Anforderung an externe Stellen
-- (Leitstelle, Nachbar-EA, übergeordnete Führung, andere BOS) mit verfolgbarem Status.
-- Eigenes Modul nach Auftrags-Template (0048). Linearer Bedarfs-Status mit Abzweig 'abgelehnt'
-- → bewusst KEIN kommunikation_status (dessen zwei Achsen passen nicht), analog Meldungs-Triage.
-- Alle Enums code-validiert (kein DB-CHECK, Bestandsmuster). ETB-Kopplung Pattern B.
CREATE TABLE nachforderung (
    id                   INTEGER PRIMARY KEY,
    einsatz_id           INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    -- Bedarf:
    art                  TEXT    NOT NULL,                 -- Kategorie (Freitext, z. B. 'RTW','SEG','Sandsäcke')
    bezeichnung          TEXT    NOT NULL,                 -- konkrete Bedarfsbeschreibung
    anzahl               INTEGER,                          -- optional; im Code >=1 validiert
    -- Adressat (externe Stelle):
    adressat_kategorie   TEXT    NOT NULL,                 -- 'leitstelle'|'nachbar_ea'|'uebergeordnet'|'andere_bos'
    adressat_bezeichnung TEXT,                             -- Freitext (welche Leitstelle/Nachbar etc.)
    begruendung          TEXT,                             -- optionaler Lagebezug
    prioritaet           TEXT    NOT NULL DEFAULT 'normal', -- 'sofort'|'dringend'|'normal'
    -- Bedarfs-Status (linear + Abzweig): angefordert→zugesagt→unterwegs→eingetroffen | abgelehnt.
    status               TEXT    NOT NULL DEFAULT 'angefordert',
    zugesagt_at          TEXT,
    unterwegs_at         TEXT,
    eingetroffen_at      TEXT,
    abgelehnt_at         TEXT,
    abgelehnt_grund      TEXT,
    angefordert_at       TEXT    NOT NULL,                 -- Ereigniszeit der Anforderung (Default jetzt im Handler)
    -- ETB-Kopplung (Pattern B): erzeugte ETB-Meldung der Anforderung.
    etb_nachforderung_id INTEGER REFERENCES etb_eintrag(id),
    erstellt_von_id      INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_nachforderung_einsatz ON nachforderung(einsatz_id, status);

-- Pattern-B-Gegenseite: ETB-Eintrag verweist zurück auf die Nachforderung (Vorbild 0048/0049;
-- berührt die FTS-Trigger auf etb_eintrag nicht).
ALTER TABLE etb_eintrag ADD COLUMN nachforderung_id INTEGER REFERENCES nachforderung(id);
