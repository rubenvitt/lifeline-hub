## ADDED Requirements

### Requirement: Vollzug erreicht offene Clients und Geräte

Nach dem Commit eines Vollzugs, der etwas geschwärzt hat, SHALL das System die Clients des
Einsatzes benachrichtigen: an die Abonnenten des Einsatzes das Ereignis `einsatz`, an die Leser
der Einsatzliste das Ereignis `einsatzliste`. Ein Client, der den Einsatz zeigt, MUST danach ohne
Neuladen den geschwärzten Stand zeigen. Das Offline-Lagebild eines Geräts MUST nach dem nächsten
Abruf von Einsatzkopf oder Einsatzliste keinen geschwärzten Wert mehr tragen.

#### Scenario: Offener Tab mit einer Person
- **WHEN** ein Tab die Personenliste des abgeschlossenen Einsatzes 7 mit `R-042` „Erika Muster“ zeigt und der Antrag für `R-042` vollzogen wird
- **THEN** zeigt der Tab ohne Neuladen statt des Namens den Platzhalter der Schwärzung

#### Scenario: Gerät, das den Einsatz gerade nicht zeigt
- **WHEN** ein Gerät die Personenliste von Einsatz 7 vor dem Vollzug im Offline-Lagebild hält, zum Zeitpunkt des Vollzugs eine andere Seite zeigt und danach die Einsatzliste abruft
- **THEN** enthält sein Offline-Lagebild keinen Stand der Personenliste von Einsatz 7 von vor dem Vollzug mehr

#### Scenario: Vollzug für den ganzen Einsatz
- **WHEN** ein Tab Einsatz 7 zeigt und der Einsatz-Antrag für Einsatz 7 vollzogen wird
- **THEN** ruft der Tab den Einsatzkopf ab, erhält 404 und löscht alle vorgehaltenen Daten von Einsatz 7

#### Scenario: Vollzug ohne Wirkung
- **WHEN** ein Antrag vollzogen wird, dessen Einsatz bereits geschwärzt war
- **THEN** verteilt der Vollzug kein Ereignis
