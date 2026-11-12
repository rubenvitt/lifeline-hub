## ADDED Requirements

### Requirement: Ein PR mit Auto-Merge ohne e2e-Lauf steht als Hinweis am PR
Ist an einem konfliktfreien PR Auto-Merge eingeschaltet und ist die zweite Stufe auf seinem
Kopf-Commit nach einer Wartezeit nicht gelaufen, MUST am PR ein Hinweis stehen, der sagt, wie die
Stufe neu angestoßen wird. Gelaufen ist sie, wenn der jüngste Check-Run eines ihrer Pflicht-Checks
weder übersprungen noch abgebrochen ist oder ihre Auswahl gerade läuft. Der Wächter MUST dafür
nichts pushen; für den Hinweis gelten die Regeln des Konflikt-Hinweises.

#### Scenario: Zweite Stufe nie angelaufen
- **WHEN** an einem PR seit mehr als 20 Minuten Auto-Merge eingeschaltet ist und sein Kopf-Commit nur übersprungene Einträge der zweiten Stufe trägt
- **THEN** trägt der PR einen Hinweis, dass die e2e-Stufe fehlt, und wie sie neu startet, auch für den Fall, dass das Label `e2e` gesetzt ist

#### Scenario: Zweite Stufe nur abgebrochen
- **WHEN** an einem PR seit mehr als 20 Minuten Auto-Merge eingeschaltet ist und der jüngste Lauf jedes e2e-Pflicht-Checks auf dem Kopf abgebrochen ist
- **THEN** trägt der PR denselben Hinweis

#### Scenario: Zweite Stufe läuft
- **WHEN** an einem PR Auto-Merge eingeschaltet ist und auf seinem Kopf-Commit die Auswahl der zweiten Stufe oder ein e2e-Pflicht-Check läuft oder fertig ist
- **THEN** entsteht kein Hinweis

#### Scenario: PR in Arbeit
- **WHEN** ein PR ohne Auto-Merge keinen e2e-Lauf trägt
- **THEN** entsteht kein Hinweis, auch wenn er das Label `e2e` trägt

## MODIFIED Requirements

### Requirement: Ein grüner PR mit Auto-Merge, der nicht mergt, steht als Hinweis am PR
Sind alle Checks und Commit-Status auf dem Kopf-Commit eines konfliktfreien PRs seit einer
Wartezeit grün und ist Auto-Merge eingeschaltet, der PR aber weiter offen, MUST am PR ein Hinweis
stehen. Je Check-Name zählt dabei der jüngste Check-Run. Ohne eingeschaltetes Auto-Merge wartet
der PR auf einen Menschen und bekommt keinen. Ist die zweite Stufe auf dem Kopf nicht gelaufen,
gilt stattdessen der Hinweis, dass die e2e-Stufe fehlt.

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
- **WHEN** auf demselben Kopf-Commit ein e2e-Lauf abgebrochen wurde, ein späterer grün ist und seit mehr als 20 Minuten nichts mergt
- **THEN** trägt der PR den Hinweis, dass er von Hand zu mergen ist

#### Scenario: Grün, aber die zweite Stufe fehlt
- **WHEN** alle vorhandenen Checks grün oder übersprungen sind, Auto-Merge an ist und die zweite Stufe nicht lief
- **THEN** trägt der PR den Hinweis, dass die e2e-Stufe fehlt, nicht den Hinweis, ihn von Hand zu mergen
