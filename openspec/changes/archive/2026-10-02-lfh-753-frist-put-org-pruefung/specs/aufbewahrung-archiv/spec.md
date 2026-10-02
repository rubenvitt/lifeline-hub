# Spec Delta

## MODIFIED Requirements

### Requirement: Frist am Einsatz anzeigen und ändern

Die Einstellungen eines Einsatzes SHALL im Bereich Aufbewahrung die Frist anzeigen: den
Zeitpunkt in der Anzeigezone, „keine Frist“ oder bei einem aktiven Einsatz den Hinweis, dass
die Frist beim Abschluss aus der Dauer entsteht. Einsatzleitung und System-Admin der
Einsatz-Org MUST die Frist dort setzen, verlängern und aufheben können, auch wenn der Einsatz
abgeschlossen ist und die übrigen Einstellungen eingefroren sind. Vor einer Verkürzung MUST
eine Rückfrage stehen, die den neuen und den alten Zeitpunkt nennt. Ohne Recht MUST die Aktion
gesperrt dastehen und ein Hinweis den Grund nennen; das gilt auch für den System-Admin einer
fremden Organisation. Die Archivakte MUST dieselbe Frist-Aktion für nicht vorgemerkte Einsätze
anbieten und für vorgemerkte, noch in der Karenz liegende das Wiederherstellen. Die Übersicht
führt in die Archivakte und trägt selbst keine Aktion.

#### Scenario: Abgeschlossener Einsatz
- **WHEN** die Einsatzleitung die Aufbewahrung eines abgeschlossenen Einsatzes öffnet
- **THEN** sieht sie die Frist und kann sie verlängern, obwohl die übrigen Einstellungen eingefroren sind

#### Scenario: Verkürzung
- **WHEN** die Einsatzleitung eine frühere Frist wählt
- **THEN** erscheint eine Rückfrage, und erst nach Bestätigung wird die Frist gesetzt

#### Scenario: Ohne Recht
- **WHEN** ein Beobachter die Aufbewahrung öffnet
- **THEN** sieht er die Frist, die Aktion ist gesperrt, und ein Hinweis nennt den Grund

#### Scenario: Admin einer fremden Organisation
- **WHEN** der System-Admin einer anderen Organisation die Aufbewahrung eines Einsatzes öffnet, in dem er kein Mitglied ist
- **THEN** sieht er die Frist, die Aktion ist gesperrt, und ein Hinweis nennt den Grund
