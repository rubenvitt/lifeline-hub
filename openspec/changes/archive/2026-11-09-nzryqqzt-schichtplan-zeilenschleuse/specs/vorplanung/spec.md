## ADDED Requirements

### Requirement: Raster der Planung ohne Sprung
Raster und Handy-Liste einer Planung MUST dieselbe Zeilenschleuse tragen wie der Schichtplan im
Einsatz (Spec `kraefte-schichtplan`, „Zeilen ohne Sprung“): neue Posten warten hinter dem
Sammelbanner, entfallene bleiben als leere Zeile „(entfallen)“ stehen, umsortierte bleiben an
ihrem Platz, Blöcke erscheinen sofort.

#### Scenario: Fremder Posten vorn einsortiert
- **WHEN** der Zeiger über einem Block der letzten Postenzeile steht und eine andere Sitzung einen Posten anlegt und an die erste Stelle der Reihenfolge setzt
- **THEN** bleibt der Block an seiner Stelle und das Banner zeigt „1 neuer Posten“; nach „anzeigen“ steht der neue Posten als erste Zeile

#### Scenario: Fremde Umsortierung
- **WHEN** der Fokus im Raster steht und eine andere Sitzung die Reihenfolge der Posten umkehrt
- **THEN** bleiben die Zeilen in der gezeigten Folge und das Banner zeigt „Reihenfolge geändert“
