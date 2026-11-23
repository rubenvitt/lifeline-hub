-- Rücknahme eines Statuswechsels bei Personal, Material und Einheit (LLH-1986, Design
-- `docs/superpowers/specs/2026-11-22-hau6f7rm-status-ruecknahme-handstatus-design.md`, E1), wie
-- beim Fahrzeug (0356): der Server hält selbst fest, was „Rückgängig“ wiederherstellt. Gesetzt bei
-- jedem echten Wechsel durch eine Person, geleert bei der Rücknahme und bei Wegen, die den Wechsel
-- überholen; NULL für alte Zeilen.
--   status_gesetzt_von  wer gewechselt hat (nur diese Person darf zurücknehmen; NULL = keine)
--   status_gesetzt_at   Zeitpunkt des Wechsels: Kennung für die Rücknahme und Beginn der Frist
--   status_vorher_id    Status vor dem Wechsel (Material: status_vorher)
--   status_vorher_seit  „Status seit“ vor dem Wechsel (nur Einheit)
--   status_ereignis_id  Zeitachsen-Ereignis, das dieser Wechsel geschrieben hat
ALTER TABLE einsatz_personal ADD COLUMN status_gesetzt_von INTEGER REFERENCES benutzer(id);
ALTER TABLE einsatz_personal ADD COLUMN status_gesetzt_at TEXT;
ALTER TABLE einsatz_personal ADD COLUMN status_vorher_id INTEGER REFERENCES personal_status(id);
ALTER TABLE einsatz_personal ADD COLUMN status_ereignis_id INTEGER
    REFERENCES einsatz_kraft_zeitachse(id) ON DELETE SET NULL;

ALTER TABLE einsatz_material ADD COLUMN status_gesetzt_von INTEGER REFERENCES benutzer(id);
ALTER TABLE einsatz_material ADD COLUMN status_gesetzt_at TEXT;
ALTER TABLE einsatz_material ADD COLUMN status_vorher TEXT
    CHECK (status_vorher IS NULL OR status_vorher IN
        ('einsatzbereit', 'im_einsatz', 'defekt', 'verbraucht', 'desinfektion_noetig'));

ALTER TABLE einsatz_einheit ADD COLUMN status_gesetzt_von INTEGER REFERENCES benutzer(id);
ALTER TABLE einsatz_einheit ADD COLUMN status_gesetzt_at TEXT;
ALTER TABLE einsatz_einheit ADD COLUMN status_vorher_id INTEGER REFERENCES fahrzeug_status(id);
ALTER TABLE einsatz_einheit ADD COLUMN status_vorher_seit TEXT;
ALTER TABLE einsatz_einheit ADD COLUMN status_ereignis_id INTEGER
    REFERENCES einsatz_kraft_zeitachse(id) ON DELETE SET NULL;
