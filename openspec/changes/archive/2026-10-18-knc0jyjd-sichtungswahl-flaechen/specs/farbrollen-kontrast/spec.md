## ADDED Requirements

### Requirement: Sichtungsfläche hält den Textboden

Text auf einer gefüllten Fläche der Sichtungswahl (SK I, SK II, SK III, SK IV, tot) SHALL im
Tagmodus mindestens 7 : 1 und im Nachtmodus mindestens 5 : 1 gegen die Fläche halten. Die Kante
jeder Fläche MUST im Tag- und im Nachtmodus gegen den Grund, auf dem sie steht, mindestens 3 : 1
halten. Das betrifft insbesondere Gelb auf hellem und Rot, Blau, Grün und Schwarz auf dunklem
Grund. Die Flächentöne MUST aus einer Stelle kommen und den BBK-Farbton eindeutig erkennen lassen.
Für Sichtungsflächen MUST es keine Großschrift-Ausnahme mit niedrigerem Boden geben.

#### Scenario: Rote Fläche am Tag
- **WHEN** im Tagmodus die Fläche „SK I“ gefüllt angezeigt wird
- **THEN** misst ihr Text gegen die Fläche mindestens 7 : 1

#### Scenario: Blaue Fläche in der Nacht
- **WHEN** im Nachtmodus die Fläche „SK IV“ auf dem Seitengrund steht
- **THEN** misst ihr Text gegen die Fläche mindestens 5 : 1
- **AND** ihre Kante misst gegen den Grund mindestens 3 : 1

#### Scenario: Gelbe Fläche auf hellem Grund
- **WHEN** im Tagmodus die Fläche „SK II“ auf einer weißen Fläche steht
- **THEN** misst ihre Kante gegen den Grund mindestens 3 : 1
