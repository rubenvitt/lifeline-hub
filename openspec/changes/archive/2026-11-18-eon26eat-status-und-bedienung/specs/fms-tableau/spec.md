## ADDED Requirements

### Requirement: Kachel aus einem Meter lesbar

Jede Kachel des FMS-Tableaus SHALL den Status als großen getönten Block zeigen, mit der Ziffer in
40 px und dem Wort darunter; der Block ist zugleich der Auslöser des Statusmenüs. Darüber stehen
der Rufname in 22 px Mono, der Fahrzeugtyp und die Einheit, sofern bekannt, sowie „seit“. Die
Kachel selbst bleibt kein Bedienziel; je Kachel gibt es genau eines.

#### Scenario: Fahrzeug mit Typ und Einheit
- **WHEN** „85-1“ (RTW, Einheit „Zug 1“) auf S2 steht
- **THEN** zeigt die Kachel „85-1“ groß, „RTW“, „Zug 1“, „seit …“ und einen Statusblock mit „2“
  in 40 px und dem Wort

#### Scenario: Ohne Schreibrecht
- **WHEN** jemand ohne Schreibrecht das Tableau öffnet
- **THEN** zeigt der Statusblock dieselbe Größe ohne Rahmen und ohne Pfeil

### Requirement: Kacheln nutzen die Breite

Die Kacheln SHALL mindestens 240 px breit sein und die Breite des Fensters in Spalten füllen. Eine
einzelne Kachel MUST NOT über die ganze Breite gezogen werden. Bei 390 px Breite MUST es keinen
waagerechten Bildlauf geben.

#### Scenario: Ein Abschnitt mit einem Fahrzeug
- **WHEN** ein Abschnitt nur ein Fahrzeug hat und das Fenster 1366 px breit ist
- **THEN** ist dessen Kachel so breit wie eine Spalte, nicht wie das Fenster

#### Scenario: Handy
- **WHEN** das Tableau bei 390 px Breite geöffnet wird
- **THEN** stehen die Kacheln in einer Spalte, ohne waagerechten Bildlauf
