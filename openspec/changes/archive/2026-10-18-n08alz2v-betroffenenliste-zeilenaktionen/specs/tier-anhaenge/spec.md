## MODIFIED Requirements

### Requirement: Pseudonyme Spur der Tier-Anhänge im Einsatztagebuch

Das System MUST beim Ablegen und beim Entfernen je einen System-Eintrag im Einsatztagebuch
schreiben, im Wortlaut „Tier T-007: Foto abgelegt“ bzw. „Tier T-007: PDF entfernt“. Der
Eintrag MUST das Tier über seine Registriernummer benennen und MUST NOT den Dateinamen, die
Kennzeichnung, den Halter, den Fundort oder einen anderen Freitext enthalten. Eine
abgewiesene Ablage MUST keinen Eintrag erzeugen.

#### Scenario: Wortlaut beim Ablegen
- **WHEN** eine Person an T-007 die Datei `Müller_Bello.jpg` ablegt
- **THEN** enthält das Einsatztagebuch genau einen neuen System-Eintrag „Tier T-007: Foto abgelegt“, und kein Eintrag des Einsatzes enthält „Müller“ oder „Bello“

#### Scenario: Wortlaut für PDF
- **WHEN** eine Person an T-007 eine PDF-Datei ablegt und sie danach entfernt
- **THEN** enthält das Einsatztagebuch „Tier T-007: PDF abgelegt“ und „Tier T-007: PDF entfernt“

#### Scenario: Abgewiesene Ablage
- **WHEN** eine Ablage mit 400, 403, 404, 409, 422 oder 503 abgewiesen wird
- **THEN** entsteht kein ETB-Eintrag
