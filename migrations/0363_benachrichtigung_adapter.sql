-- LLH-2026 (Design-Doc docs/superpowers/specs/2026-11-22-k5fdiw6n-adapter-stoerung-melden-design.md):
-- Störungen einer Anbindung melden sich an die Admins der Org. Eine Benachrichtigung hängt jetzt
-- an genau einem Ort: einem Einsatz (`einsatz_id`) oder einem Adapter (`adapter_id`, fällt mit
-- ihm per CASCADE). Dazu drei Arten. Neubau nach Muster 0352; ein Blatt-Umbau (keine Tabelle
-- verweist auf `benachrichtigung`), in der Transaktion von sqlx.
--
-- `adapter.gemeldet` hält fest, was zur laufenden Störung schon gemeldet ist (`gestoert`,
-- `eingriff`); leer, wenn nichts. Er sorgt dafür, dass eine Störung sich nur einmal meldet.
CREATE TABLE benachrichtigung_neu (
    id           INTEGER PRIMARY KEY,
    einsatz_id   INTEGER REFERENCES einsatz(id) ON DELETE CASCADE,
    adapter_id   TEXT    REFERENCES adapter(id) ON DELETE CASCADE,
    benutzer_id  INTEGER NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
    art          TEXT    NOT NULL CHECK (art IN (
        'sofortmeldung', 'sofortmeldung_eskaliert', 'auftrag_ueberfaellig', 'abloesung_faellig',
        'erinnerung_faellig', 'abloesung_vorwarnung', 'abloesung_planung', 'abloesung_abloeser',
        'auftrag_erteilt', 'auftrag_quittiert', 'auftrag_erledigt', 'befehl', 'lagebericht',
        'meldung', 'rueckmeldung_ueberfaellig', 'lagebesprechung_vorher', 'lagebesprechung_faellig',
        'nachforderung_status', 'gefahr', 'sichtung_eins', 'vermisstenmeldung', 'wieder_verfuegbar',
        'chat_erwaehnung', 'einsatz_aufnahme', 'einsatz_neu', 'unwetter', 'fuehrung_ungueltig',
        'fuehrung_uebernommen', 'fuehrung_angefragt', 'adapter_eingriff', 'adapter_gestoert',
        'adapter_wieder_ok')),
    stufe        TEXT    NOT NULL CHECK (stufe IN ('alarm', 'hinweis', 'still')),
    bezug_typ    TEXT    NOT NULL,
    bezug_id     INTEGER NOT NULL,
    ausloeser_id INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    erstellt_at  TEXT    NOT NULL,
    quittiert_at TEXT,
    -- 0275 und 0282: die gemeinte und die auslösende Einheit (ohne REFERENCES, Begründung dort).
    einheit_id       INTEGER,
    durch_einheit_id INTEGER,
    CHECK ((einsatz_id IS NULL) <> (adapter_id IS NULL))
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
CREATE INDEX idx_benachrichtigung_adapter ON benachrichtigung(adapter_id);

ALTER TABLE adapter ADD COLUMN gemeldet TEXT CHECK (gemeldet IN ('gestoert', 'eingriff'));
