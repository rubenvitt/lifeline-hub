## MODIFIED Requirements

### Requirement: Ein grüner PR mit Auto-Merge, der nicht mergt, bekommt einen Hinweis
Sind alle Checks und Commit-Status auf dem Kopf-Commit eines konfliktfreien PRs seit einer
Wartezeit grün und ist Auto-Merge eingeschaltet, der PR aber weiter offen, MUST am PR ein Hinweis
stehen. Je Check-Name zählt dabei der jüngste Check-Run. Ohne eingeschaltetes Auto-Merge wartet
der PR auf einen Menschen und bekommt keinen. Weicht das Ruleset des Ziel-Branches von den
Pflicht-Checks ab, MUST der Hinweis die Abweichung als wahrscheinliche Ursache nennen.

#### Scenario: Grün seit einer Stunde
- **WHEN** alle Checks eines PRs seit mehr als 20 Minuten grün sind, Auto-Merge eingeschaltet ist und der PR offen ist
- **THEN** trägt der PR einen Hinweis, dass er von Hand zu mergen ist

#### Scenario: Ohne Auto-Merge
- **WHEN** alle Checks eines PRs grün sind und Auto-Merge nicht eingeschaltet ist
- **THEN** entsteht kein Hinweis

#### Scenario: Ein Status steht noch aus
- **WHEN** alle Check-Runs grün sind, ein Commit-Status aber noch aussteht oder rot ist
- **THEN** entsteht kein Hinweis

#### Scenario: Erster Lauf abgebrochen, zweiter grün
- **WHEN** auf demselben Kopf-Commit ein Lauf eines Checks abgebrochen wurde, ein späterer grün ist und seit mehr als 20 Minuten nichts mergt
- **THEN** trägt der PR den Hinweis, dass er von Hand zu mergen ist

#### Scenario: Baut mit Ziel-Branch rechnet noch
- **WHEN** alle übrigen Checks grün sind, Auto-Merge an ist und der jüngste `Baut mit Ziel-Branch` noch läuft
- **THEN** entsteht kein Hinweis

#### Scenario: Quelle im Ruleset
- **WHEN** ein PR grün ist, Auto-Merge an ist, nicht mergt und im Ruleset `Migrationsnummern` die Quelle „GitHub Actions“ trägt
- **THEN** nennt der Hinweis diese Quelle als Ursache und rät, sie auf „Any source“ zu stellen

#### Scenario: Ruleset nicht lesbar
- **WHEN** ein PR grün ist, nicht mergt und die Regeln des Ziel-Branches nicht lesbar sind
- **THEN** trägt der PR den Hinweis wie bisher, ohne Ursache aus dem Ruleset
