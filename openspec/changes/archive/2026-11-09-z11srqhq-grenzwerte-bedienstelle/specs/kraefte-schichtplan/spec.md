## ADDED Requirements

### Requirement: Grenzwerte bedienen
Die Einstellungen des Einsatzes SHALL Höchstdienst und Mindestruhe zeigen, ändern und auf die
Vorgabe zurücksetzen. Wer in der Ablösung schreiben darf, darf das auch; für alle anderen ist es
nur lesbar. Ein Wert, für den die Vorgabe gilt, MUST als Vorgabe gekennzeichnet sein. Dauern
MUST in derselben Form wie in der Ablösung stehen, nie dezimal. Die Ansicht „Schichtplan“ MUST
die wirksamen Werte nennen und SHALL keine zweite Bedienstelle haben.

#### Scenario: Vorgabe gekennzeichnet
- **WHEN** ein Einsatz keinen eigenen Höchstdienst und keine eigene Mindestruhe setzt
- **THEN** stehen in den Einstellungen „12 h (Vorgabe)“ und „8 h (Vorgabe)“, und der Schichtplan nennt dieselben Werte

#### Scenario: Eigenen Wert setzen
- **WHEN** die Einsatzleitung den Höchstdienst auf „10 h“ setzt
- **THEN** steht „10 h“ ohne Kennzeichnung, ein ETB-Systemsatz entsteht, und Schichtplan, Meldebild und Personalliste prüfen ohne Neuladen gegen 10 h

#### Scenario: Leeres Feld heißt Vorgabe
- **WHEN** jemand im Dialog das Feld „Mindestruhe“ leert und speichert
- **THEN** gilt für die Mindestruhe wieder die Vorgabe 8 h, und der Höchstdienst bleibt, wie er war

#### Scenario: Vorgaben wiederherstellen
- **WHEN** ein eigener Wert gilt und jemand „Vorgaben wiederherstellen“ wählt
- **THEN** gelten für beide Werte die Vorgaben, ohne Rückfrage, und „Rückgängig“ stellt die vorherigen Werte wieder her

#### Scenario: Grenzen der Eingabe
- **WHEN** jemand als Höchstdienst „45 min“ oder als Mindestruhe „25 h“ eingibt
- **THEN** nennt das Feld den erlaubten Bereich in Dauerform, und es wird nichts gespeichert

#### Scenario: Ohne Schreibrecht
- **WHEN** jemand ohne Schreibrecht in der Ablösung die Einstellungen oder den Schichtplan öffnet
- **THEN** sieht er die wirksamen Werte, aber weder „Werte ändern“ noch „Vorgaben wiederherstellen“ noch den Sprung „ändern“
