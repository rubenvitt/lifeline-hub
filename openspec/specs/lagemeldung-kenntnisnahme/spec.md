# lagemeldung-kenntnisnahme Specification

## Purpose
Eine an die Lage übergebene Meldung bleibt „neu“, bis jemand mit Schreibrecht sie als gesehen kennzeichnet. Der Stand gilt für alle Benutzer gleich und speist den Modulzähler der Lagemeldungen (LLH-1206).

## Requirements

### Requirement: Eine übergebene Lagemeldung ist neu, bis sie gesehen ist
Eine Lagemeldung SHALL als „neu“ gelten, solange niemand sie als gesehen gekennzeichnet hat. Das
Merkmal gilt für alle Benutzer des Einsatzes gleich. Die Antwort von `GET …/lage/meldungen` MUST
je Lagemeldung `is_neu`, `gesehen_at`, `gesehen_von_id` und `gesehen_von_name` enthalten.

#### Scenario: Frisch übergeben
- **WHEN** eine Meldung an die Lage übergeben wird
- **THEN** liefert die Liste der Lagemeldungen sie mit `is_neu: true` und ohne `gesehen_at`

#### Scenario: Gleicher Stand für alle
- **WHEN** Benutzer A eine Lagemeldung als gesehen kennzeichnet
- **THEN** liefert die Liste sie auch für Benutzer B mit `is_neu: false`, `gesehen_von_name` von A

### Requirement: Kenntnisnahme nur mit Schreibrecht
Das System SHALL zwei Wege anbieten, Lagemeldungen als gesehen zu kennzeichnen: eine einzelne
(`POST …/lage/meldungen/{lid}/gesehen`) und alle neuen bis einschließlich einer gegebenen
(`POST …/lage/meldungen/gesehen` mit `bis_id`). Beide MUST Schreibzugriff auf das Modul
`lagemeldungen` verlangen. Die erste Kenntnisnahme MUST gewinnen; eine zweite ändert Zeitpunkt und
Person nicht.

#### Scenario: Einzeln gesehen
- **WHEN** ein Benutzer mit Schreibrecht eine neue Lagemeldung als gesehen kennzeichnet
- **THEN** antwortet das System mit HTTP 200, und die Lagemeldung trägt seinen Namen und den
  Zeitpunkt

#### Scenario: Zweite Kenntnisnahme
- **WHEN** ein zweiter Benutzer dieselbe Lagemeldung danach als gesehen kennzeichnet
- **THEN** antwortet das System mit HTTP 200, und Zeitpunkt und Person bleiben die des ersten

#### Scenario: Alle bis zur angezeigten
- **WHEN** der Einsatz die neuen Lagemeldungen 4, 5 und 7 hat und ein Benutzer alle bis `bis_id`
  6 als gesehen kennzeichnet
- **THEN** sind 4 und 5 gesehen, 7 bleibt neu, und die Antwort nennt `gesehen: 2`

#### Scenario: Nur lesen
- **WHEN** ein Benutzer, der das Modul nur lesen darf, eine Lagemeldung als gesehen kennzeichnen
  will
- **THEN** antwortet das System mit HTTP 403, und die Lagemeldung bleibt neu

#### Scenario: Fremder Einsatz
- **WHEN** die Lagemeldung zu einem anderen Einsatz gehört als der im Pfad
- **THEN** antwortet das System mit HTTP 404

### Requirement: Geänderter Text macht die Lagemeldung wieder neu
Übergibt jemand eine bereits übergebene Meldung erneut mit anderem Text, MUST die Lagemeldung
wieder als neu gelten. Eine erneute Übergabe mit gleichem Text MUST den Stand unverändert lassen.

#### Scenario: Neuer Text
- **WHEN** eine gesehene Lagemeldung mit geändertem Text erneut übergeben wird
- **THEN** ist sie wieder `is_neu: true`, ohne `gesehen_at`

#### Scenario: Gleicher Text
- **WHEN** eine gesehene Lagemeldung mit gleichem Text erneut übergeben wird
- **THEN** bleibt sie gesehen, mit unverändertem Zeitpunkt und unveränderter Person

### Requirement: Die Seite Lagemeldungen zeigt und setzt den Stand
Die Seite Lagemeldungen SHALL jede neue Lagemeldung mit der Marke „Neu“ kennzeichnen und, mit
Schreibrecht, je Zeile „Als gesehen markieren“ und im Kopf „Alle als gesehen markieren“ anbieten. Eine gesehene Zeile MUST
Zeitpunkt und Person der Kenntnisnahme nennen, sofern bekannt. Ohne Schreibrecht MUST beide Knöpfe
fehlen.

#### Scenario: Alle gesehen
- **WHEN** die Seite drei neue Lagemeldungen zeigt und der Benutzer „Alle als gesehen markieren“ wählt
- **THEN** trägt keine der drei mehr die Marke „Neu“, und der Knopf „Alle als gesehen markieren“ verschwindet

#### Scenario: Ohne Schreibrecht
- **WHEN** ein Benutzer das Modul nur lesen darf
- **THEN** sieht er die Marke „Neu“, aber weder „Als gesehen markieren“ noch „Alle als gesehen markieren“
