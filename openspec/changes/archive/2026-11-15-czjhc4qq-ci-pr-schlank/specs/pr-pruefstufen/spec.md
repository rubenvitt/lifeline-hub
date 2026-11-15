## ADDED Requirements

### Requirement: Ein PR zeigt keine Jobs der Kanal-Branches
Ein Ereignis an einem PR MUST keinen Job anlegen, der nur bei einem Push auf einen Kanal-Branch läuft, auch nicht als übersprungen. An einem PR ohne `voll` MUST aus dem PR-Workflow der Prüfungen höchstens ein übersprungener Eintrag stehen: der Aufruf der Suiten. Die Namen der Pflicht-Checks MUST dabei unverändert bleiben.

#### Scenario: PR ohne Label
- **WHEN** auf einen PR ohne `voll` gepusht wird
- **THEN** stehen am PR weder `Release`, `Testberichte zusammenführen`, `Verteilen` noch `Offene PRs neu bewerten`, und aus dem PR-Workflow der Prüfungen erscheint als übersprungen höchstens der Aufruf der Suiten

#### Scenario: Pflicht-Checks unverändert
- **WHEN** ein PR fertig ist und alle Pflicht-Checks grün sind
- **THEN** heißen sie `Schnellprüfungen`, `Migrationsnummern`, `ADR-Nummern` und `Baut mit Ziel-Branch`, und das Ruleset braucht keine Änderung

#### Scenario: Push auf alpha
- **WHEN** ein PR auf `alpha` gemergt wird
- **THEN** laufen auf dem Merge-Commit weiter Schnellprüfungen, alle Suiten, das Verteilen von `Baut mit Ziel-Branch` und das Neubewerten der Migrationsnummern
