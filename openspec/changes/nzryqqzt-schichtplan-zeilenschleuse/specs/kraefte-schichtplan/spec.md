## ADDED Requirements

### Requirement: Zeilen ohne Sprung
Raster und Handy-Liste des Schichtplans MUST Änderungen anderer ohne Sprung unter dem Zeiger
zeigen. Solange der Fokus im Schichtplan steht, ein Maus- oder Stiftzeiger über ihm bewegt wurde
und ihn nicht verlassen hat, ein Zug im Raster läuft, eine Person auf einen Block gezogen wird oder
ein Dialog des Schichtplans offen ist, MUST die Menge der Zeilen, ihre Folge und ihre
Gruppenzugehörigkeit stehen bleiben:
- Ein neuer Posten SHALL hinter einem Sammelbanner warten.
- Ein entfallener Posten SHALL als leere, gedämpfte Zeile mit dem Zusatz „(entfallen)“ stehen
  bleiben. In ihr MUST weder ein Block angelegt noch ein Block abgelegt werden können.
- Ein umsortierter oder in einen anderen Abschnitt umgehängter Posten SHALL an seinem Platz
  bleiben.

Blöcke und der Titel einer Zeile MUST weiter sofort erscheinen. Das Sammelbanner MUST das
Wartende nennen („1 neuer Posten“, „2 neue Posten“, „1 Posten entfallen“, „Reihenfolge
geändert“, verbunden mit „ · “) und es mit „anzeigen“ übernehmen; danach stehen die Zeilen in der
frischen Folge. Das Banner MUST selbst keine Zeile verschieben. Ein Touch-Tipp zählt nicht als
Zeiger. Ohne gezeigte Zeile und solange die Quellen der Zeilen (Einheiten, UHS, Abschnitte)
noch laden, hält die Schleuse nichts zurück.

#### Scenario: Neuer Posten unter dem Zeiger
- **WHEN** der Zeiger über einem Block der Streife 2 steht und eine andere Sitzung eine Einheit im ersten Abschnitt anlegt
- **THEN** bleibt der Block an seiner Stelle, die neue Einheit erscheint nicht, und das Banner zeigt „1 neuer Posten“

#### Scenario: Übernehmen
- **WHEN** das Banner „1 neuer Posten“ zeigt und jemand „anzeigen“ wählt
- **THEN** steht die neue Einheit in ihrer Zeile im ersten Abschnitt und das Banner ist weg

#### Scenario: Entfallener Posten
- **WHEN** der Fokus im Raster steht und eine andere Sitzung eine Einheit ohne Blöcke auflöst
- **THEN** bleibt ihre Zeile leer und gedämpft mit „(entfallen)“ stehen, und das Banner zeigt „1 Posten entfallen“

#### Scenario: Block fließt direkt
- **WHEN** der Zeiger über dem Raster steht und eine andere Sitzung an RTW 1 einen Block anlegt
- **THEN** erscheint der Block sofort in der Zeile RTW 1, und es gibt kein Banner

#### Scenario: Ohne Zeiger und Fokus
- **WHEN** weder Zeiger noch Fokus im Schichtplan stehen und kein Zug und kein Dialog läuft
- **THEN** erscheinen neue, entfallene und umsortierte Posten sofort, ohne Banner
