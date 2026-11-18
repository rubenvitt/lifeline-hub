-- Rücknahme eines FMS-Statuswechsels (LLH-1781, Change `eon26eat-status-und-bedienung`,
-- design.md D8): der Server hält selbst fest, was „Rückgängig“ wiederherstellt, statt es dem
-- Client zu glauben. Gesetzt bei jedem echten Wechsel, geleert bei der Rücknahme; NULL für alte
-- Zeilen.
--   status_gesetzt_von  wer gewechselt hat (nur diese Person darf zurücknehmen)
--   status_vorher_id    Status vor dem Wechsel
--   status_vorher_seit  „Status seit“ vor dem Wechsel
--   status_ereignis_id  Zeitachsen-Ereignis der Einheit, das dieser Wechsel geschrieben hat
ALTER TABLE einsatz_fahrzeug ADD COLUMN status_gesetzt_von INTEGER REFERENCES benutzer(id);
ALTER TABLE einsatz_fahrzeug ADD COLUMN status_vorher_id INTEGER REFERENCES fahrzeug_status(id);
ALTER TABLE einsatz_fahrzeug ADD COLUMN status_vorher_seit TEXT;
ALTER TABLE einsatz_fahrzeug ADD COLUMN status_ereignis_id INTEGER
    REFERENCES einsatz_kraft_zeitachse(id) ON DELETE SET NULL;
