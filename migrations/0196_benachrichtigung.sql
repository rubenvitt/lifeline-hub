-- LLH-1207: Benachrichtigungen je Empfänger (Change kcjecn9e-benachrichtigungskonzept, design.md
-- D1). Eine Zeile je Empfänger und Benachrichtigung; den anzuzeigenden Text bildet der Server
-- beim Lesen aus dem Bezugsobjekt (`benachrichtigung::text`), es gibt bewusst keine Textspalte:
-- sonst entstünde eine zweite Kopie von Inhalten, die Aufbewahrung und Schwärzung mitpflegen
-- müssten.
--
-- Die Zeile hängt am Einsatz und fällt mit seinem Purge (ON DELETE CASCADE). Den laufenden
-- Bestand räumt der Erinnerungs-Scheduler: quittierte Zeilen nach 24 h, unquittierte nach 12 h
-- (`benachrichtigung::repo::aufraeumen`).
--
-- `art` und `stufe` spiegeln `benachrichtigung::BenachrichtigungArt::ALLE` bzw.
-- `BenachrichtigungStufe::ALLE` (Guard `check_listen_entsprechen_dem_katalog`). `bezug_typ`
-- prüft nur Rust (`BenachrichtigungBezugTyp::parse`), damit ein neuer Bezug keinen
-- Tabellenumbau braucht.
CREATE TABLE benachrichtigung (
    id           INTEGER PRIMARY KEY,
    einsatz_id   INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    benutzer_id  INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    art          TEXT    NOT NULL CHECK (art IN (
        'sofortmeldung', 'sofortmeldung_eskaliert', 'auftrag_ueberfaellig', 'abloesung_faellig',
        'erinnerung_faellig', 'abloesung_vorwarnung', 'auftrag_erteilt', 'auftrag_quittiert',
        'auftrag_erledigt', 'befehl', 'lagebericht', 'meldung', 'lagebesprechung_vorher',
        'lagebesprechung_faellig', 'nachforderung_status', 'gefahr', 'sichtung_eins',
        'wieder_verfuegbar', 'chat_erwaehnung', 'einsatz_aufnahme', 'einsatz_neu', 'unwetter')),
    stufe        TEXT    NOT NULL CHECK (stufe IN ('alarm', 'hinweis')),
    bezug_typ    TEXT    NOT NULL,
    bezug_id     INTEGER NOT NULL,
    -- Wer das Ereignis ausgelöst hat; NULL beim Scheduler. Der Auslöser selbst bekommt nie eine
    -- Zeile, die Spalte dient nur der Nachvollziehbarkeit.
    ausloeser_id INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    erstellt_at  TEXT    NOT NULL,
    quittiert_at TEXT
);

-- Lesen und Nachreichen: die Zeilen eines Empfängers, jüngste zuerst.
CREATE INDEX idx_benachrichtigung_benutzer ON benachrichtigung(benutzer_id, erstellt_at);
CREATE INDEX idx_benachrichtigung_einsatz ON benachrichtigung(einsatz_id);
