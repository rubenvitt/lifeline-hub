-- LLH-2058 (API-Routen englisch, Paket 12, ADR-0085): `/api/einsaetze/{id}/meldungen` heißt
-- jetzt `/api/einsaetze/{id}/reports`. Offene Anträge eines Spiegels tragen die Pfadvorlage;
-- der Führer sucht sie unter den beantragbaren Erfassungen (`instanz::spiegel::antrag`) und
-- lehnte die alte als unbekannte Art ab. Die übrigen Vorlagen ziehen ihre Pakete selbst um.
UPDATE spiegel_antrag
   SET pfad_vorlage = '/api/einsaetze/{id}/reports'
 WHERE pfad_vorlage = '/api/einsaetze/{id}/meldungen';
