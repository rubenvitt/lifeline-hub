-- LLH-2055 (Paket 9 von LLH-1979, ADR-0095): Die Routen der Personen, Betreuung, Evakuierung
-- und Verpflegung heißen englisch. `spiegel_antrag.pfad_vorlage` speichert das Routenmuster einer
-- am Spiegel beantragten Erfassung; der Führer sucht es in `instanz::spiegel::antrag::BEANTRAGBAR`.
-- Ohne Umschreiben lehnte er einen vor dem Update gestellten Antrag als „Unbekannte Art des
-- Antrags“ ab. Fremde Muster bleiben.
UPDATE spiegel_antrag
SET pfad_vorlage = CASE pfad_vorlage
    WHEN '/api/einsaetze/{id}/personen' THEN '/api/einsaetze/{id}/persons'
    WHEN '/api/einsaetze/{id}/personen/{pid}/sichtung' THEN '/api/einsaetze/{id}/persons/{pid}/triage'
    WHEN '/api/einsaetze/{id}/personen/{pid}/verbleib' THEN '/api/einsaetze/{id}/persons/{pid}/whereabouts'
    WHEN '/api/einsaetze/{id}/personen/{pid}/notizen' THEN '/api/einsaetze/{id}/persons/{pid}/notes'
    WHEN '/api/einsaetze/{id}/personen/{pid}/transport' THEN '/api/einsaetze/{id}/persons/{pid}/transport'
    WHEN '/api/einsaetze/{id}/personen/{pid}/anlass' THEN '/api/einsaetze/{id}/persons/{pid}/reason'
    WHEN '/api/einsaetze/{id}/personen/{pid}/massnahmen' THEN '/api/einsaetze/{id}/persons/{pid}/interventions'
    WHEN '/api/einsaetze/{id}/personen/{pid}/verletzungen' THEN '/api/einsaetze/{id}/persons/{pid}/injuries'
    WHEN '/api/einsaetze/{id}/evakuierung/bezirke/{bid}/staende' THEN '/api/einsaetze/{id}/evacuation/districts/{bid}/progress'
    WHEN '/api/einsaetze/{id}/betreuung/stellen/{sid}/belegungen' THEN '/api/einsaetze/{id}/care/positions/{sid}/occupancies'
    WHEN '/api/einsaetze/{id}/betreuung/stellen/{sid}/registrierungen' THEN '/api/einsaetze/{id}/care/positions/{sid}/registrations'
    WHEN '/api/einsaetze/{id}/betreuung/stellen/{sid}/abmeldungen' THEN '/api/einsaetze/{id}/care/positions/{sid}/departures'
    WHEN '/api/einsaetze/{id}/verpflegung/zeitfenster/{zid}/ausgaben' THEN '/api/einsaetze/{id}/catering/time-slots/{zid}/distributions'
    ELSE pfad_vorlage
END
WHERE pfad_vorlage LIKE '/api/einsaetze/{id}/personen%'
   OR pfad_vorlage LIKE '/api/einsaetze/{id}/evakuierung/%'
   OR pfad_vorlage LIKE '/api/einsaetze/{id}/betreuung/%'
   OR pfad_vorlage LIKE '/api/einsaetze/{id}/verpflegung/%';
