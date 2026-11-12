## ADDED Requirements

### Requirement: Ein PR mit Auto-Merge ohne e2e-Lauf steht als Hinweis am PR
Ist an einem konfliktfreien PR Auto-Merge eingeschaltet und trägt sein Kopf-Commit nach einer
Wartezeit keinen e2e-Lauf (kein Check-Run eines e2e-Anteils, in welchem Zustand auch immer),
MUST am PR ein Hinweis stehen, der sagt, wie die zweite Stufe neu angestoßen wird. Der Wächter
MUST dafür nichts pushen. Für Hinweis, Neuschreiben und „behoben“ gelten dieselben Regeln wie
für den Konflikt-Hinweis.

#### Scenario: Zweite Stufe nie angelaufen
- **WHEN** an einem PR seit mehr als 20 Minuten Auto-Merge eingeschaltet ist und sein Kopf-Commit keinen Check-Run `e2e 1/4` bis `e2e 4/4` trägt
- **THEN** trägt der PR einen Hinweis, dass die e2e-Stufe fehlt, und wie sie neu startet

#### Scenario: Zweite Stufe läuft
- **WHEN** an einem PR Auto-Merge eingeschaltet ist und auf seinem Kopf-Commit e2e-Anteile laufen oder schon fertig sind
- **THEN** entsteht kein Hinweis

#### Scenario: PR in Arbeit
- **WHEN** ein PR ohne Auto-Merge keinen e2e-Lauf trägt
- **THEN** entsteht kein Hinweis, auch wenn er das Label `e2e` trägt
