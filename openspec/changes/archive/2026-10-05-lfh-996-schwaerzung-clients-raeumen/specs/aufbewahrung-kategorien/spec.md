## ADDED Requirements

### Requirement: Kategorie-Schwärzung erreicht offene Clients und Geräte

Nach dem Commit einer Kategorie-Schwärzung SHALL das System an die Abonnenten des Einsatzes das
Ereignis `einsatz` und an die Leser der Einsatzliste das Ereignis `einsatzliste` verteilen,
zusätzlich zu den Modul-Ereignissen der Kategorie. Für offene Clients und das Offline-Lagebild
MUST dasselbe gelten wie beim Vollzug eines Personen-Antrags.

#### Scenario: Kategorie an einem lesbaren Einsatz geschwärzt
- **WHEN** die Kategorie `behandlung` an Einsatz 7 geschwärzt wird, während ein Gerät Daten von Einsatz 7 im Offline-Lagebild hält
- **THEN** enthält das Offline-Lagebild nach dem nächsten Abruf von Einsatzkopf oder Einsatzliste keinen Stand von Einsatz 7 von vor der Schwärzung mehr
