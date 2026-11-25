-- LLH-2061 (API-Routen englisch, Paket 15, ADR-0097): Das Präfix `/api/einsaetze` heißt jetzt
-- `/api/incidents`. Offene Anträge eines Spiegels tragen die Pfadvorlage; der Führer sucht sie
-- unter den beantragbaren Erfassungen (`instanz::spiegel::antrag`) und lehnte eine alte als
-- unbekannte Art ab. Getauscht wird nur das Präfix, fremde Vorlagen bleiben.
UPDATE spiegel_antrag
   SET pfad_vorlage = '/api/incidents' || substr(pfad_vorlage, length('/api/einsaetze') + 1)
 WHERE pfad_vorlage = '/api/einsaetze'
    OR substr(pfad_vorlage, 1, length('/api/einsaetze/')) = '/api/einsaetze/';
