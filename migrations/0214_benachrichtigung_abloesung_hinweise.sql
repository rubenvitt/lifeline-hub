-- LLH-1131: Hinweise der Ablösung an die Führung (Spec `benachrichtigungen`, `kraefte-abloesung`;
-- Entscheidung LLH-1118 Punkt 5, Korrektur LLH-1131). Zwei neue Benachrichtigungsarten:
--   abloesung_planung   kurz vor der Fälligkeit ist noch keine ablösende Einheit geplant
--                       (Planungshinweis, dritte Frist neben Vorwarnung und Fälligkeit)
--   abloesung_abloeser  bei der geplanten ablösenden Einheit tut sich etwas (alarmiert,
--                       eingetroffen, am Bereitstellungsraum eingetroffen, abgerufen) oder ihre
--                       Planung entfällt; was, steckt im Bezug (`abloeser_*`, ohne CHECK)
-- Beide sind Hinweise; die Einstufung der Schicht bleibt bei drei Stufen.
--
-- SQLite ändert einen CHECK nur per Neubau. `benachrichtigung` ist ein Blatt (keine Tabelle
-- verweist darauf; `grep -l benachrichtigung migrations/*.sql`: 0196, die übrigen nur im
-- Kommentar), ohne AUTOINCREMENT, Trigger und Views → kein PRAGMA-foreign_keys-Umschalter, das
-- DROP löst keine Kaskade aus. Muster 0212 (`demo_herkunft`): neue Tabelle, Zeilen 1:1 mit ihren
-- ids, alte weg, umbenennen, Indizes wortgleich neu. Schema = 0196 1:1, geändert ist nur der
-- CHECK auf `art`; seine Liste spiegelt `benachrichtigung::BenachrichtigungArt::ALLE` (Guard
-- `check_listen_entsprechen_dem_katalog`). Abgesichert von
-- db::tests::migration_0214_baut_benachrichtigung_mit_den_hinweisen_der_abloesung_neu.
CREATE TABLE benachrichtigung_neu (
    id           INTEGER PRIMARY KEY,
    einsatz_id   INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    benutzer_id  INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    art          TEXT    NOT NULL CHECK (art IN (
        'sofortmeldung', 'sofortmeldung_eskaliert', 'auftrag_ueberfaellig', 'abloesung_faellig',
        'erinnerung_faellig', 'abloesung_vorwarnung', 'abloesung_planung', 'abloesung_abloeser',
        'auftrag_erteilt', 'auftrag_quittiert', 'auftrag_erledigt', 'befehl', 'lagebericht',
        'meldung', 'lagebesprechung_vorher', 'lagebesprechung_faellig', 'nachforderung_status',
        'gefahr', 'sichtung_eins', 'wieder_verfuegbar', 'chat_erwaehnung', 'einsatz_aufnahme',
        'einsatz_neu', 'unwetter')),
    stufe        TEXT    NOT NULL CHECK (stufe IN ('alarm', 'hinweis')),
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

-- Die Indizes aus 0196 fielen mit dem DROP; wortgleich neu.
CREATE INDEX idx_benachrichtigung_benutzer ON benachrichtigung(benutzer_id, erstellt_at);
CREATE INDEX idx_benachrichtigung_einsatz ON benachrichtigung(einsatz_id);
