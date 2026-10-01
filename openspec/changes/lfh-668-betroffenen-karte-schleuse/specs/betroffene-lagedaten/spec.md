# Spec Delta

## ADDED Requirements

### Requirement: Kartenansicht hält Menge und Lage, solange jemand mit ihr arbeitet
Solange der Mauszeiger oder ein Stift über der Kartenansicht der Betroffenen liegt, der Fokus in
ihr steht oder ein Bündel aufgefächert ist, SHALL die Kartenansicht Menge und Lage ihrer
Personen-Marker halten. Zugänge, verlegte und entfallene Personen MUST warten. Sichtung und
Beschriftung der gezeigten Marker MUST weiter live aktualisieren.

#### Scenario: Zugang neben dem Marker unter dem Zeiger
- **WHEN** der Mauszeiger auf einem Personen-Marker liegt und live eine Person wenige Meter daneben verortet wird
- **THEN** bleibt der Marker unter dem Zeiger als Einzelmarker stehen, und es entsteht kein Bündel

#### Scenario: Sichtung ändert sich während des Zeigens
- **WHEN** der Mauszeiger über der Karte liegt und live die Sichtung einer gezeigten Person von SK III auf SK I wechselt
- **THEN** zeigt ihr Marker sofort Farbe und Kurzzeichen von SK I an derselben Stelle

#### Scenario: Entfallene Person bleibt stehen, bis der Stand angewandt wird
- **WHEN** der Mauszeiger über der Karte liegt und live eine gezeigte Person storniert wird
- **THEN** bleibt ihr Marker stehen, und der Sammelbanner nennt sie als entfallen

#### Scenario: Ohne Zeiger, Fokus und Auffächerung gilt der Live-Stand sofort
- **WHEN** weder Zeiger noch Fokus in der Kartenansicht liegen, kein Bündel aufgefächert ist und live eine Person verortet wird
- **THEN** erscheint ihr Marker sofort, und es steht kein Sammelbanner

### Requirement: Sammelbanner der Kartenansicht
Wartet bei geschlossener Schleuse mindestens eine Änderung, SHALL die Kopfzeile der Kartenansicht
einen Sammelbanner zeigen. Er MUST nennen, wie viele Personen neu, verlegt oder entfallen sind,
und eine Aktion „anzeigen“ bieten, die den Live-Stand anwendet. Sein Erscheinen und Verschwinden
MUST die Karte nicht verschieben.

#### Scenario: Banner nennt das Wartende
- **WHEN** bei geschlossener Schleuse live zwei Personen verortet werden und eine gezeigte Person eine andere Koordinate bekommt
- **THEN** nennt der Sammelbanner zwei neue und eine verlegte Person und bietet „anzeigen“ an

#### Scenario: „anzeigen“ wendet den Stand an
- **WHEN** der Mensch im Sammelbanner „anzeigen“ wählt
- **THEN** zeigt die Karte den Live-Stand, und der Sammelbanner verschwindet

#### Scenario: Banner verschiebt die Karte nicht
- **WHEN** der Sammelbanner bei 390 px oder 1366 px Breite erscheint oder verschwindet
- **THEN** bleibt die Oberkante der Karte auf derselben Höhe, und der CLS-Beitrag ist 0

### Requirement: Schleuse öffnet beim Verlassen
Verlassen Zeiger und Fokus die Kartenansicht und ist kein Bündel aufgefächert, SHALL die
Kartenansicht den Live-Stand anwenden. Der Weg vom Marker zum Sammelbanner MUST die Schleuse
nicht öffnen, weil Banner und Karte in derselben Kartenansicht liegen.

#### Scenario: Zeiger verlässt die Karte
- **WHEN** Änderungen warten und der Mauszeiger die Kartenansicht verlässt, ohne dass ein Bündel aufgefächert ist
- **THEN** zeigt die Karte den Live-Stand, und der Sammelbanner verschwindet

#### Scenario: Zeiger geht zum Banner
- **WHEN** Änderungen warten und der Mauszeiger von der Karte auf den Sammelbanner wandert
- **THEN** bleibt der gehaltene Stand stehen, bis der Mensch „anzeigen“ wählt oder die Kartenansicht verlässt

#### Scenario: Touch mit aufgefächertem Bündel
- **WHEN** auf einem Touch-Gerät ein Bündel aufgefächert ist und live eine Person nahe dem Bündel verortet wird
- **THEN** bleibt die Auffächerung stehen, und der Zugang wartet, bis das Bündel zugeklappt ist

### Requirement: Hinweiszeile behauptet keine Vollständigkeit, solange Zugänge warten
Die Hinweiszeile der Kartenansicht SHALL „Alle angetroffenen Personen dieser Auswahl stehen auf
der Karte“ nur sagen, wenn kein Zugang wartet. Wartet einer und fehlt keiner Person die
Koordinate, MUST sie stattdessen sagen, dass keine Person ohne Koordinate ist.

#### Scenario: Letzte Lücke schließt sich bei geschlossener Schleuse
- **WHEN** bei geschlossener Schleuse die letzte Person ohne Koordinate live verortet wird
- **THEN** sagt die Hinweiszeile „Keine Person ohne Koordinate“, und der Sammelbanner nennt eine neue Person
