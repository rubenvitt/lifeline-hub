# Spec Delta

## ADDED Requirements

### Requirement: Die Erklärung einer Notübernahme passt in die Grenze des Gegenübers
Eine Notübernahme MUST NOT eine Erklärung erzeugen, die größer ist, als das Gegenüber an einer
Akte annimmt (4096 Byte). Als Unterzeichner MUST die Erklärung höchstens die ersten 200 Zeichen
des Anzeigenamens tragen. Ist die Erklärung danach noch zu groß, MUST der Server mit 422
ablehnen, ohne dass die Führung wechselt oder ein Eintrag im Verlauf entsteht. Das gilt für die
Notübernahme gegen die erreichte Seite, mit Unterschrift und mit Code.

#### Scenario: Langer Bestandsname übernimmt trotzdem
- **WHEN** ein Admin am ELW, dessen Anzeigename 3000 Zeichen lang ist, eine Notübernahme gegen den Hub mit dem Grund „Hub ohne Verbindung“ bestätigt
- **THEN** führt der ELW, die Erklärung nennt die ersten 200 Zeichen des Namens als Unterzeichner, und der Hub nimmt die Akte bei der nächsten Meldung an

#### Scenario: Erklärung knapp unter der Grenze
- **WHEN** Grund und Unterzeichner so gewählt sind, dass die Erklärung genau 4096 Byte groß ist
- **THEN** gilt die Notübernahme, und die Akte geht mit der Erklärung an das Gegenüber

#### Scenario: Erklärung knapp über der Grenze
- **WHEN** Grund und Unterzeichner so gewählt sind, dass die Erklärung nach dem Kürzen des Unterzeichners 4097 Byte groß wäre
- **THEN** antwortet der Server mit 422 und nennt den Grund als das, was zu kürzen ist; die Führung bleibt, wo sie war, und der Verlauf bekommt keinen Eintrag

#### Scenario: Zu große Erklärung vor der Unterschrift
- **WHEN** ein Admin am Hub eine Notübernahme mit eigener Unterschrift beginnt und die Erklärung zu groß wäre
- **THEN** antwortet schon der Beginn mit 422, und es wird nichts zum Unterschreiben vorgelegt

#### Scenario: Zu große Erklärung mit Code
- **WHEN** jemand am Hub eine Notübernahme mit dem Code des Gegenübers erklärt und die Erklärung zu groß wäre
- **THEN** antwortet der Server mit 422, und die Führung bleibt beim ELW
