# Spec Delta

## MODIFIED Requirements

### Requirement: Zeilenaktionen eines Fahrzeugs

Die Fahrzeugliste SHALL je Zeile und je Karte ein Aktionsmenü führen, dessen erster Eintrag
„Entlassen“ ist; danach folgen die weiteren Aktionen eines Fahrzeugs (Angaben ändern, beim
Stamm-Fahrzeug der Sprung in den Stamm, bei einem Fahrzeug ohne Einheit mit Freigabe des Moduls
Einheiten „Als eigene Einheit führen …“), Stornieren rot hinter einem Trenner. „Entlassen“ MUST
neutral stehen, ohne Rückfrage wirken und einen Rückgängig-Hinweis zeigen, der das Fahrzeug
vollständig zurücknimmt. Auf der Karte (schmale Fläche) MUST kein Knopf „Entlassen“ stehen; der
Status bleibt dort in der Titelzeile. Das Lösen einer Person von der Besatzung MUST „Vom Fahrzeug
lösen“ heißen und ohne Rückfrage wirken.

#### Scenario: Ad-hoc-Fahrzeug in der Tabelle
- **WHEN** das Menü eines Ad-hoc-Fahrzeugs mit Einheit in der Tabelle geöffnet wird
- **THEN** stehen „Entlassen“, „Angaben ändern …“, ein Trenner und rot „Stornieren“

#### Scenario: Ad-hoc-Fahrzeug ohne Einheit
- **WHEN** das Menü eines Ad-hoc-Fahrzeugs ohne Einheit in der Tabelle geöffnet wird und das Modul Einheiten freigegeben ist
- **THEN** stehen „Entlassen“, „Angaben ändern …“, „Als eigene Einheit führen …“, ein Trenner und rot „Stornieren“

#### Scenario: Entlassen aus dem Menü
- **WHEN** im Menü „Entlassen“ gewählt wird
- **THEN** ist das Fahrzeug ohne Rückfrage entlassen, und „Rückgängig“ steht bereit

#### Scenario: Karte
- **WHEN** die Fahrzeugliste als Karte erscheint
- **THEN** trägt die Karte keinen Knopf „Entlassen“, ihr Menü beginnt mit „Entlassen“, und der Status steht in der Titelzeile

#### Scenario: Person lösen
- **WHEN** bei einer Person der Besatzung „Vom Fahrzeug lösen“ gewählt wird
- **THEN** sitzt sie ohne Rückfrage auf keinem Fahrzeug mehr
