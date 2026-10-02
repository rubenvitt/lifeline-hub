# Spec Delta

## MODIFIED Requirements

### Requirement: Pseudonyme Archivakte

Die Archivakte SHALL den Einsatzkopf, den Aufbewahrungszustand, den Zustand je Datenkategorie
(Frist, Vormerkung, Karenz-Ende, Schwärzung, Rechtsgrundlage, Zustand nach der Capability
`aufbewahrung-kategorien`) und ein Register der Personen, Tiere und Schäden zeigen. Jede
Angabe MUST aus einer Spalte stammen, die die Klassifikation der Capability `aufbewahrung`
als Retain führt. Die Akte MUST deshalb vor und nach der Schwärzung dieselben Felder tragen.
Einsatzort, Koordinate des Einsatzorts, meldende Stelle und Sachverhalt MUST fehlen. Das
Register MUST je Eintrag die Registriernummer in Anzeigeform, Status, Zeitstempel und bei
Personen die Sichtungs- und Verbleibkategorie tragen, bei Tieren die Tierart, bei Schäden Typ
und Ausmaß. Namen, Kontakte, Adressen, Orte, Beschreibungen und Notizen MUST fehlen, auch
während der Karenz, in der sie in der Datenbank noch stehen.

#### Scenario: Während der Karenz
- **WHEN** der Admin die Akte eines vorgemerkten, noch nicht geschwärzten Einsatzes abruft, dessen Person „Erika Mustermann“ heißt
- **THEN** enthält die Antwort weder „Erika“ noch „Mustermann“
- **AND** führt das Register die Person als `R-001` mit Status und Sichtungskategorie

#### Scenario: Nach der Schwärzung
- **WHEN** der Admin dieselbe Akte nach der Schwärzung abruft
- **THEN** trägt sie dieselben Felder wie während der Karenz

#### Scenario: Kategorien in der Akte
- **WHEN** der Admin die Akte eines Einsatzes abruft, dessen Kategorie `personenauskunft` geschwärzt ist
- **THEN** führt die Akte `personenauskunft` mit Zustand `geschwaerzt`, Zeitpunkt der Schwärzung und Rechtsgrundlage
- **AND** führt sie die übrigen Kategorien mit ihrem jeweiligen Zustand

### Requirement: Frist am Einsatz anzeigen und ändern

Die Einstellungen eines Einsatzes SHALL im Bereich Aufbewahrung die Frist anzeigen: den
Zeitpunkt in der Anzeigezone, „keine Frist“ oder bei einem aktiven Einsatz den Hinweis, dass
die Frist beim Abschluss aus der Dauer entsteht. Darunter MUST je Datenkategorie ihre Frist,
ihr Zustand und ihre Rechtsgrundlage stehen, bei einem aktiven Einsatz die Dauer, aus der die
Kategorie-Frist beim Abschluss entsteht, oder der Hinweis, dass sie der Einsatz-Frist folgt.
Einsatzleitung und System-Admin MUST die Frist des Einsatzes dort setzen, verlängern und
aufheben können, auch wenn der Einsatz abgeschlossen ist und die übrigen Einstellungen
eingefroren sind; die Frist jeder Kategorie ebenso, sobald der Einsatz abgeschlossen ist. Vor einer Verkürzung MUST eine Rückfrage stehen, die den neuen
und den alten Zeitpunkt nennt. Ohne Recht MUST die Aktion gesperrt dastehen und ein Hinweis
den Grund nennen. Die Archivakte MUST dieselbe Frist-Aktion für nicht vorgemerkte Einsätze
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

#### Scenario: Kategorie verlängern
- **WHEN** die Einsatzleitung die Frist der vorgemerkten Kategorie `anhaenge` auf einen künftigen Zeitpunkt setzt
- **THEN** zeigt die Kategorie danach `frist_laeuft` mit der neuen Frist

#### Scenario: Aktiver Einsatz
- **WHEN** die Einsatzleitung die Aufbewahrung eines aktiven Einsatzes öffnet, dessen Organisation für `personenauskunft` 0 Tage vorgibt
- **THEN** steht bei `personenauskunft` der Hinweis, dass die Frist beim Abschluss nach 0 Tagen entsteht
- **AND** steht bei den übrigen Kategorien, dass sie der Einsatz-Frist folgen
