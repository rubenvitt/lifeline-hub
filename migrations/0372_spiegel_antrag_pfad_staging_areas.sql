-- LLH-2056 (API-Routen englisch, Paket 10, ADR-0097): `…/bereitstellungsraeume/{bid}/eintreffen`
-- heißt jetzt `…/staging-areas/{bid}/arrival`. Offene Anträge eines Spiegels tragen die
-- Pfadvorlage; der Führer sucht sie unter den beantragbaren Erfassungen
-- (`instanz::spiegel::antrag`) und lehnte die alte als unbekannte Art ab. Andere Vorlagen bleiben.
UPDATE spiegel_antrag
   SET pfad_vorlage = '/api/einsaetze/{id}/staging-areas/{bid}/arrival'
 WHERE pfad_vorlage = '/api/einsaetze/{id}/bereitstellungsraeume/{bid}/eintreffen';
