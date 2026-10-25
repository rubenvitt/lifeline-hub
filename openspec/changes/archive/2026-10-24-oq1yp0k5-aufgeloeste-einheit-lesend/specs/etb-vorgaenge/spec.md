## ADDED Requirements

### Requirement: Verweis auf genannte Einheiten
Jede API-Antwort, die einen ETB-Eintrag ausliefert, SHALL die Einheiten tragen, die der Eintrag
festhält (`einheiten`, je Kennung und Name, leer statt fehlend): die Empfänger eines Auftrags beim
Schreiben und die Einheit des Systemeintrags „Einheit «…» aufgelöst“. Die ETB-Zeitachse SHALL je
Einheit einen Verweis „Einheit «Name»“ zeigen, der ihre Ansicht öffnet, auch die einer
aufgelösten. Das ↗ MUST NOT Teil des zugänglichen Namens sein; ein Systemeintrag mit diesem
Verweis MUST einzeln stehen.

#### Scenario: Sprung aus dem Eintrag der Auflösung
- **WHEN** eine Person im ETB am Eintrag „Einheit «Florian 1» aufgelöst“ den Verweis
  „Einheit «Florian 1»“ anklickt
- **THEN** öffnet die lesende Ansicht der aufgelösten Einheit „Florian 1“

#### Scenario: Auftrag an zwei Einheiten
- **WHEN** ein Auftrag an „Florian 1“ und „Florian 2“ erteilt wird
- **THEN** trägt sein ETB-Eintrag beide Einheiten, und die Zeitachse zeigt beide Verweise

#### Scenario: Filter Einheit findet die Auflösung
- **WHEN** die ETB-Liste mit dem Filter „betrifft Einheit“ für „Florian 1“ abgefragt wird,
  nachdem sie aufgelöst wurde
- **THEN** steht der Eintrag „Einheit «Florian 1» aufgelöst“ unter den Treffern

#### Scenario: Eintrag ohne Einheit
- **WHEN** ein Handeintrag ohne Auftrag abgefragt wird
- **THEN** trägt er `einheiten` als leere Liste, und die Zeitachse zeigt keinen Einheit-Verweis
