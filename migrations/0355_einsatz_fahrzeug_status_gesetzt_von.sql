-- Wer den FMS-Status eines Fahrzeugs zuletzt gewechselt hat (LLH-1781, Change
-- `eon26eat-status-und-bedienung`, design.md D8): die Rücknahme „Rückgängig“ gelingt nur der
-- Person, die gewechselt hat. Gesetzt bei jedem echten Wechsel, geleert bei der Rücknahme; NULL
-- für alte Zeilen und für Wechsel ohne Person.
ALTER TABLE einsatz_fahrzeug ADD COLUMN status_gesetzt_von INTEGER REFERENCES benutzer(id);
