## Purpose

Hält das Ruleset von `alpha` auf genau den vereinbarten Pflicht-Checks, in einer Form, die die
Checks und Status der eigenen CI erfüllen können, und macht jede Abweichung sofort als roten Lauf
sichtbar, statt dass PRs still hängen.

## ADDED Requirements

### Requirement: Die Pflicht-Checks stehen an einer Stelle im Repository
Welche Checks auf `alpha` Pflicht sind und ob sie als Commit-Status oder als Check-Run entstehen, MUST an genau einer Stelle im Repository stehen. Jede Prüfung des Rulesets MUST diese Stelle lesen.

#### Scenario: Pflicht kommt hinzu
- **WHEN** ein weiterer Pflicht-Check vereinbart und an dieser Stelle eingetragen wird, das Ruleset aber noch ohne ihn ist
- **THEN** meldet die nächste Prüfung den fehlenden Pflicht-Check

### Requirement: Das Ruleset von alpha wird gegen die Pflicht-Checks geprüft
Nach jedem Push auf `alpha`, mindestens alle sechs Stunden und auf Anstoß MUST ein Lauf die geltenden Regeln von `alpha` lesen und gegen die Pflicht-Checks prüfen. Fehlt eine Pflicht, steht eine zusätzliche im Ruleset, verlangt das Ruleset „Branches must be up to date“ oder sind die Regeln nicht lesbar, MUST der Lauf rot enden und die Abweichung nennen.

#### Scenario: Pflicht fehlt
- **WHEN** im Ruleset `ADR-Nummern` nicht mehr Pflicht ist
- **THEN** endet der nächste Lauf rot und nennt `ADR-Nummern` als fehlend

#### Scenario: Alte Suite noch Pflicht
- **WHEN** im Ruleset noch `e2e 1/4` Pflicht ist, das ein PR nicht mehr fährt
- **THEN** endet der Lauf rot und nennt `e2e 1/4` als nicht vereinbart

#### Scenario: Up to date verlangt
- **WHEN** das Ruleset verlangt, dass ein PR vor dem Merge auf dem Stand des Ziel-Branches ist
- **THEN** endet der Lauf rot und nennt diese Einstellung

#### Scenario: Ruleset in Ordnung
- **WHEN** das Ruleset genau die vereinbarten Pflicht-Checks in erfüllbarer Form trägt
- **THEN** endet der Lauf grün

### Requirement: Ein Status-Pflicht-Check trägt keine Quelle
Ein Pflicht-Check, den die CI als Commit-Status setzt, MUST im Ruleset ohne Quelle („Any source“) stehen. Ein Pflicht-Check, der als Check-Run entsteht, MUST ohne Quelle oder mit der Quelle GitHub Actions stehen. Jede andere Quelle MUST die Prüfung rot machen.

#### Scenario: Quelle an Migrationsnummern
- **WHEN** `Migrationsnummern` im Ruleset die Quelle „GitHub Actions“ trägt
- **THEN** endet der Lauf rot und nennt `Migrationsnummern` mit der Quelle als Ursache

#### Scenario: Schnellprüfungen mit GitHub Actions
- **WHEN** `Schnellprüfungen` die Quelle „GitHub Actions“ trägt
- **THEN** gilt das als in Ordnung
