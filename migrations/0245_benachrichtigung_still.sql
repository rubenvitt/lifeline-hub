-- LLH-1143: Benachrichtigungszentrale (Entwurf /mnt/project-files/llh-1022/llh-1143/design.md, D2;
-- Entscheidung Ruben zu LLH-1142 E1: drei Stufen Alarm, Eingang, Still). Die dritte Stufe `still`
-- wird eine Zeile: eine Benachrichtigung, die für den Empfänger still ist (Art abgeschaltet,
-- Vorgabe seiner Rolle „still“), steht im Verlauf, zählt aber nie. Sie wird schon gelesen
-- geschrieben (`quittiert_at = erstellt_at`, `benachrichtigung::repo::anlegen`). `hinweis` bleibt
-- der Wire-Wert der Stufe Eingang.
--
-- SQLite ändert einen CHECK nur per Neubau. `benachrichtigung` ist weiter ein Blatt (keine Tabelle
-- verweist darauf), ohne AUTOINCREMENT, Trigger und Views → kein PRAGMA-foreign_keys-Umschalter,
-- das DROP löst keine Kaskade aus. Muster 0214: neue Tabelle, Zeilen 1:1 mit ihren ids, alte weg,
-- umbenennen, Indizes wortgleich neu. Schema = 0214 1:1, geändert ist nur der CHECK auf `stufe`;
-- seine Liste spiegelt `benachrichtigung::BenachrichtigungStufe::ALLE` (Guard
-- `check_listen_entsprechen_dem_katalog`). Abgesichert von
-- db::tests::migration_0245_baut_benachrichtigung_mit_der_stufe_still_neu.
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

-- Die Indizes aus 0214 fielen mit dem DROP; wortgleich neu.
CREATE INDEX idx_benachrichtigung_benutzer ON benachrichtigung(benutzer_id, erstellt_at);
CREATE INDEX idx_benachrichtigung_einsatz ON benachrichtigung(einsatz_id);
