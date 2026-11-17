## ADDED Requirements

### Requirement: Austritt aus der UHS zurücknehmen
Das System SHALL den Austritt einer Person aus einer UHS zurücknehmen. Die Rücknahme MUST ein
neues Belegungsereignis sein, das den Austritt nennt. Sie bringt die Person in dieselbe UHS, auf
ihren Platz davor, wenn er frei oder nur durch diesen Austritt in Aufbereitung ist, sonst in den
Wartebereich. Abgelehnt (409, ohne Änderung) MUST sie werden, wenn der Austritt nicht der jüngste
Schritt der Person ist, älter als zehn Minuten, schon zurückgenommen ist oder ein automatischer
Austritt mit Anlass war.

#### Scenario: Zurück auf den Platz
- **WHEN** eine Person auf Platz 3 der UHS Turnhalle ausgetragen wird und Platz 3 dadurch in Aufbereitung geht und die Rücknahme eine Minute später eingeht
- **THEN** liegt die Person wieder auf Platz 3, und Platz 3 ist belegt statt in Aufbereitung

#### Scenario: Platz inzwischen vergeben
- **WHEN** nach dem Austragen eine andere Person auf Platz 3 gelegt wurde und die Rücknahme eingeht
- **THEN** steht die Person wieder in der UHS Turnhalle im Wartebereich, und die Antwort sagt, dass der Platz nicht frei war

#### Scenario: Person inzwischen in einer anderen UHS
- **WHEN** die Person nach dem Austragen in die UHS Zelt Nord aufgenommen wurde und die Rücknahme eingeht
- **THEN** lehnt der Server mit 409 ab, und die Person bleibt in der UHS Zelt Nord

### Requirement: Wartezeit läuft über die Rücknahme weiter
„Wartet seit“ und der Aufenthalt „seit“ einer Person MUST ein Paar aus zurückgenommenem Austritt
und seiner Rücknahme übergehen: Sie zeigen den Zeitpunkt, der vor dem Austritt galt. Die Folge
nach Wartezeit MUST damit unverändert bleiben.

#### Scenario: Wartebereich nach Fehltipp
- **WHEN** eine Person seit 13:10 im Wartebereich der UHS Turnhalle wartet, um 13:40 ausgetragen und um 13:41 zurückgenommen wird
- **THEN** nennt ihr Aufenthalt „seit 13:10“, und sie steht im Wartebereich an derselben Stelle der Folge wie vor dem Austragen

### Requirement: Austragen rückgängig im Patientenkopf
Nach „Austragen“ im Patientenkopf SHALL ein Hinweis „<Kennung> aus <UHS> ausgetragen“ mit
„Rückgängig“ stehen, der die Rücknahme des eben gebuchten Austritts sendet. Kehrt die Person nur
in den Wartebereich zurück, MUST ein Hinweis das sagen. Eine Ablehnung MUST unter den Handlungen
des Aufenthalts stehen, ohne Fehler-Toast.

#### Scenario: Rückgängig nach Austragen
- **WHEN** jemand bei R-009 auf Platz 3 der UHS Turnhalle „Austragen“ und im Hinweis „Rückgängig“ wählt
- **THEN** zeigt der Kopf wieder „Turnhalle · Platz 3 · seit …“ mit der Zeit vor dem Austragen

#### Scenario: Ablehnung im Kopf
- **WHEN** die Rücknahme abgelehnt wird, weil R-009 inzwischen in der UHS Zelt Nord liegt
- **THEN** steht der Grund unter den Handlungen des Aufenthalts, und es erscheint kein Fehler-Toast
