-- LLH-1425: fehlende Quellen des Benachrichtigungskatalogs (Entscheidung Ruben zu LLH-1142 E1,
-- 22.10.2026). Zwei neue Arten: `rueckmeldung_ueberfaellig` (Eingang, vom Scheduler) und
-- `vermisstenmeldung` (Alarm, beim Wechsel einer Person auf vermisst). Die neuen Bezüge der
-- ablösenden Einheit (`abloeser_*_gestrichen`) brauchen nichts: `bezug_typ` hat keinen CHECK.
--
-- 1. `benachrichtigung` bekommt die zwei Arten im CHECK auf `art`. SQLite ändert einen CHECK nur
--    per Neubau; Muster 0249 (Blatt-Tabelle ohne Verweise, AUTOINCREMENT, Trigger und Views):
--    neue Tabelle, Zeilen 1:1 mit ihren ids, alte weg, umbenennen, Indizes wortgleich neu. Schema
--    = 0249 1:1, geändert ist nur die `art`-Liste; sie spiegelt
--    `benachrichtigung::BenachrichtigungArt::ALLE` (Guard `check_listen_entsprechen_dem_katalog`).
--
-- 2. Merker der Überfälligkeit an der Einheit: die Kennung der Meldung (`meldung.id`), deren
--    Überfälligkeit als letzte Rückmeldung schon gemeldet ist (`meldung::rueckmeldung`). Der
--    Scheduler setzt ihn per Vergleich VOR dem Melden; ein weiterer Takt findet ihn gesetzt. Eine
--    neue Rückmeldung ist eine andere Meldung, ihre spätere Überfälligkeit meldet wieder. Bewusst
--    ohne REFERENCES: eine Meldung zu löschen soll nicht an einem Merker hängen bleiben.
--    Aufbewahrung: Verweis ohne Personenbezug, retain (`einsatz::schwaerzung_registry`).
--
-- Abgesichert von db::tests::migration_0255_baut_benachrichtigung_mit_den_neuen_arten_neu.
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
        'chat_erwaehnung', 'einsatz_aufnahme', 'einsatz_neu', 'unwetter')),
    stufe        TEXT    NOT NULL CHECK (stufe IN ('alarm', 'hinweis', 'still')),
    bezug_typ    TEXT    NOT NULL,
    bezug_id     INTEGER NOT NULL,
    -- Wer das Ereignis ausgelöst hat; NULL beim Scheduler. Der Auslöser selbst bekommt nie eine
    -- Zeile, die Spalte dient nur der Nachvollziehbarkeit.
    ausloeser_id INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    erstellt_at  TEXT    NOT NULL,
    quittiert_at TEXT
);

INSERT INTO benachrichtigung_neu
    (id, einsatz_id, benutzer_id, art, stufe, bezug_typ, bezug_id, ausloeser_id, erstellt_at,
     quittiert_at)
    SELECT id, einsatz_id, benutzer_id, art, stufe, bezug_typ, bezug_id, ausloeser_id,
           erstellt_at, quittiert_at
    FROM benachrichtigung
    ORDER BY id;

DROP TABLE benachrichtigung;

ALTER TABLE benachrichtigung_neu RENAME TO benachrichtigung;

-- Die Indizes aus 0249 fielen mit dem DROP; wortgleich neu.
CREATE INDEX idx_benachrichtigung_benutzer ON benachrichtigung(benutzer_id, erstellt_at);
CREATE INDEX idx_benachrichtigung_einsatz ON benachrichtigung(einsatz_id);

ALTER TABLE einsatz_einheit ADD COLUMN rueckmeldung_ueberfaellig_meldung_id INTEGER;
