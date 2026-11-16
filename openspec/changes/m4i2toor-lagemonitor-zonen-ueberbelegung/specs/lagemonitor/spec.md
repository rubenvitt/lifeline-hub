# Spec Delta

## ADDED Requirements

### Requirement: Gefahrenzonen mit Name und Warnstufe

Der Lagemonitor SHALL jede Gefahrenzone auf der Karte in mindestens 28 px beschriften. Ein
Gefahrengebiet MUST die Bezeichnung seines Gebiets (ohne Bezeichnung „Gefahrengebiet“) und die
höchste Warnstufe tragen, bei unbestätigter Beurteilung zusätzlich „unbestätigt“, und in der
Farbe seiner Warnstufe wie auf der Lagekarte erscheinen. Absperrungen und Sperrgebiete MUST ihr
Artwort tragen.

#### Scenario: Gefahrengebiet mit hoher Stufe

- **WHEN** das Gefahrengebiet „Hangrutsch Kirchberg“ in seiner Matrix die höchste Stufe „hoch“ hat und seine Beurteilung bestätigt ist
- **THEN** steht an seiner Fläche „Hangrutsch Kirchberg · hoch“ in mindestens 28 px
- **AND** ist die Fläche in der Alarmfarbe gefärbt

#### Scenario: Beurteilung offen

- **WHEN** das Gefahrengebiet „Hangrutsch Kirchberg“ die Stufe „mittel“ hat und niemand die Beurteilung bestätigt hat
- **THEN** steht an seiner Fläche „Hangrutsch Kirchberg · mittel · unbestätigt“
- **AND** ist die Fläche in der Achtungsfarbe gefärbt

#### Scenario: Gefahrengebiet ohne Bezeichnung

- **WHEN** ein Gefahrengebiet keine Bezeichnung hat und die Stufe „akut“
- **THEN** steht an seiner Fläche „Gefahrengebiet · akut“

#### Scenario: Absperrung

- **WHEN** der Einsatz einen Absperrbereich mit der Beschriftung „Garten Familie Muster“ hat
- **THEN** steht an seiner Fläche „Absperrbereich“
- **AND** erscheint „Garten Familie Muster“ weder auf dem Monitor noch in der Antwort des Servers

### Requirement: Zonen ohne Freitext

Die Verdichtung des Lagemonitors SHALL zu einer Gefahrenzone nur Typ, Geometrie und, bei einem
Gefahrengebiet, Bezeichnung, höchste Warnstufe und Bestätigung des Gebiets liefern. Beschriftung
und Notiz der Zone sowie der Name dessen, der die Beurteilung bestätigt hat, MUST NOT in der
Antwort stehen.

#### Scenario: Freitexte einer Zone

- **WHEN** eine Gefahrengebiet-Zone die Beschriftung „Haus Muster“ und die Notiz „Herr Muster wartet“ trägt und ihr Gebiet „Hangrutsch Kirchberg“ heißt
- **THEN** enthält die Antwort an den Monitor „Hangrutsch Kirchberg“, die Warnstufe und die Bestätigung
- **AND** enthält sie weder „Haus Muster“ noch „Herr Muster wartet“ noch den Namen der bestätigenden Person

### Requirement: Überbelegte Unfallhilfsstelle in Alarmrolle

Liegen in einer Unfallhilfsstelle mehr Personen, als sie Plätze hat, SHALL der Lagemonitor ihre
Belegung „Belegte/Plätze“ in der Alarmrolle zeigen, sie in der Kachel „Belegung der
Unfallhilfsstellen“ vor nicht überbelegten Stellen reihen und in deren Titelzeile „n überbelegt“
in der Alarmrolle nennen. Die Kartenmarke der Stelle MUST Belegte und Plätze zeigen, überbelegt in
der Alarmrolle.

#### Scenario: Acht Personen auf fünf Plätzen

- **WHEN** in der UHS Turnhalle acht Personen liegen und sie fünf Plätze hat
- **THEN** zeigt die Kachel „Belegung der Unfallhilfsstellen“ für die UHS Turnhalle „8/5“ in der Alarmrolle
- **AND** steht in der Titelzeile der Kachel „1 überbelegt“
- **AND** trägt die Kartenmarke der UHS Turnhalle „8/5“ in der Alarmrolle

#### Scenario: Überbelegt, aber kleiner als andere

- **WHEN** sieben Unfallhilfsstellen je zehn Belegte auf zwanzig Plätzen haben und die UHS Turnhalle acht auf fünf
- **THEN** steht die UHS Turnhalle in der Kachel an erster Stelle

#### Scenario: Volle Stelle ist nicht überbelegt

- **WHEN** in einer UHS fünf Personen auf fünf Plätzen liegen
- **THEN** steht ihre Belegung „5/5“ ohne Alarmrolle
- **AND** fehlt „überbelegt“ in der Titelzeile

#### Scenario: Stelle ohne Plätze

- **WHEN** eine UHS keine Plätze hat und zwei Personen dort liegen
- **THEN** zeigt der Monitor für sie die Zahl 2 ohne Alarmrolle
