# Spec Delta

## MODIFIED Requirements

### Requirement: Deeplink öffnet das Detail

Ein Deeplink auf ein Objekt der Fläche SHALL dieses Objekt wählen, das Detail öffnen, die Karte in
den Sichtbereich holen und sie markieren. Filter, die das Objekt verbergen würden, MUST dabei
zurückgesetzt werden. Der Deeplink-Parameter MUST nach dem Anwenden aus der Adresse verschwinden.
Eine Wahl von Hand MUST die Markierung entfernen. Gibt es das verlinkte Objekt im Einsatz nicht
(mehr), MUST über der Liste die Hinweisleiste der Fähigkeit `seiten-zustaende` erscheinen, statt
dass der Deeplink still verschwindet. Ein Objekt MUST dann nicht gewählt sein.

#### Scenario: Deeplink bei aktivem Filter
- **WHEN** ein Filter aktiv ist, der das verlinkte Objekt ausblendet, und der Deeplink geöffnet wird
- **THEN** ist der Filter zurückgesetzt, das Objekt gewählt, seine Karte markiert und im Sichtbereich

#### Scenario: Neu laden nach dem Deeplink
- **WHEN** nach dem Anwenden des Deeplinks die Seite neu geladen wird
- **THEN** enthält die Adresse den Parameter nicht mehr, und die Markierung fehlt

#### Scenario: Wahl von Hand
- **WHEN** nach einem Deeplink eine andere Karte gewählt wird
- **THEN** trägt keine Karte mehr die Markierung

#### Scenario: Deeplink auf ein Objekt, das es nicht gibt
- **WHEN** ein Deeplink auf einen Auftrag geöffnet wird, den es im Einsatz nicht gibt
- **THEN** steht über der Liste „Auftrag #<Nummer> gibt es nicht (mehr)“
- **AND** keine Karte ist gewählt oder markiert, und die Adresse enthält den Parameter nicht mehr
