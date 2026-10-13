# Spec Delta

## MODIFIED Requirements

### Requirement: Einstiege von der Stab-Seite erben die Sperre ihres Ziels
Die S6-Kachel der Stab-Seite SHALL Funkplan, Fernmeldeskizze, Sprechgruppen und
Kommunikationsplan als Sprünge in das Modul Fernmeldewesen führen: den Funkplan auf die Startseite
des Moduls, Fernmeldeskizze und Sprechgruppen auf die jeweilige Darstellung des Funkplans, den
Kommunikationsplan auf seine Unterroute. Der Funkplan SHALL die Zahl der Funkplan-Lücken tragen.
Ist das Fernmeldewesen für die Person gesperrt, MUST jeder dieser Sprünge gesperrt erscheinen und
den Grund nennen, ohne Zahl; ist es ausgeblendet, MUST er fehlen.

#### Scenario: Sprung gesperrt
- **WHEN** eine Person den Stab öffnen darf, das Fernmeldewesen aber nicht
- **THEN** stehen die S6-Sprünge gesperrt mit Grund, ohne Zahl, und ein Klick springt nicht

#### Scenario: Sprung in die Skizze
- **WHEN** eine Person in der S6-Kachel auf „Fernmeldeskizze“ tippt
- **THEN** öffnet sich das Fernmeldewesen mit der Darstellung Fernmeldeskizze

#### Scenario: Ausgeblendet
- **WHEN** das Fernmeldewesen für den Einsatz ausgeblendet ist
- **THEN** zeigt die S6-Kachel keinen der vier Sprünge
