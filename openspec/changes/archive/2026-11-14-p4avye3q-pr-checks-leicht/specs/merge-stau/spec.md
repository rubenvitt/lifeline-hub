# Spec Delta

## ADDED Requirements

### Requirement: Ein grüner PR mit Auto-Merge, der nicht mergt, bekommt einen Hinweis
Sind alle Checks und Commit-Status auf dem Kopf-Commit eines konfliktfreien PRs seit einer
Wartezeit grün und ist Auto-Merge eingeschaltet, der PR aber weiter offen, MUST am PR ein Hinweis
stehen. Je Check-Name zählt dabei der jüngste Check-Run. Ohne eingeschaltetes Auto-Merge wartet
der PR auf einen Menschen und bekommt keinen.

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

## MODIFIED Requirements

### Requirement: Der Zustand von alpha wird nach jedem CI-Lauf bewertet
Nach jedem abgeschlossenen CI-Lauf auf `alpha`, stündlich und von Hand MUST der Wächter
feststellen, ob `alpha` rot ist: im jüngsten abgeschlossenen CI-Lauf schlägt eine Prüfung fehl,
ein Fehler allein beim Release zählt nicht. Ein abgebrochener Lauf (ein neuer Push hat seine
Tests abgebrochen) MUST übersprungen werden; es zählt der Lauf davor. Läuft ein neu gestarteter
Lauf oder sind seine Jobs nicht lesbar, MUST der Zustand als unbestimmt gelten. Als Ursache MUST
er die zwischen letztem Grün und erstem Rot gemergten PRs nennen.

#### Scenario: Zwei Merges brechen zusammen
- **WHEN** nach einem grünen Lauf #1319 und #1315 gemergt werden und der nächste CI-Lauf auf `alpha` in der Rust-Suite fehlschlägt
- **THEN** gilt `alpha` als rot, und #1319 und #1315 sind als vermutliche Ursache genannt

#### Scenario: Nur der Release scheitert
- **WHEN** alle Prüfungen eines CI-Laufs auf `alpha` grün sind und nur der Release-Job fehlschlägt
- **THEN** gilt `alpha` nicht als rot

#### Scenario: Lauf noch nicht fertig
- **WHEN** der jüngste CI-Lauf auf `alpha` noch läuft und der davor grün war
- **THEN** gilt `alpha` nicht als rot

#### Scenario: Abgebrochener Lauf
- **WHEN** der jüngste abgeschlossene CI-Lauf auf `alpha` abgebrochen ist, weil ein neuer Push seine Tests abbrach, und der davor grün war
- **THEN** gilt `alpha` nicht als rot

#### Scenario: Roter Lauf wird neu gestartet
- **WHEN** der rote Lauf neu gestartet wird und noch läuft
- **THEN** gilt `alpha` weder als rot noch als grün: kein Hinweis wird geschlossen, nichts wird gemergt

#### Scenario: Jobs nicht lesbar
- **WHEN** der jüngste Lauf fehlgeschlagen ist und seine Jobs nicht lesbar sind
- **THEN** gilt `alpha` als unbestimmt, nicht als grün

## REMOVED Requirements

### Requirement: Ein grüner PR mit Auto-Merge, der nicht mergt, steht als Hinweis am PR
**Reason**: Der Bezug zur zweiten Stufe entfällt (LLH-1889).
**Migration**: „Ein grüner PR mit Auto-Merge, der nicht mergt, bekommt einen Hinweis“, gleiche Hinweis-Art `haengt`.

### Requirement: Ein PR mit Auto-Merge ohne e2e-Lauf steht als Hinweis am PR
**Reason**: Im PR gibt es keine e2e-Stufe mehr, auf die Auto-Merge warten könnte (LLH-1889).
**Migration**: Keine. Ein bestehender Hinweis dieser Art wird beim nächsten Lauf des Wächters auf „behoben“ gesetzt.
