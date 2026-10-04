## ADDED Requirements

### Requirement: Warn- und Erfolgstext in der Textrolle des Status

Text, den antd als Warnung oder Erfolg auszeichnet (darunter `Typography` vom Typ `warning` und
`success`), MUST die Textrolle des Status tragen (`achtung` beziehungsweise `normal` als Text),
nicht die Füllfarbe und keinen von antd abgeleiteten Ton. Er MUST den Boden der Spec halten. Die
Färbung MUST app-weit aus einer Stelle kommen. Kante, Badge und Ikone bleiben bei der Füllfarbe.

#### Scenario: Warntext in der Leiste der Lagekarte
- **WHEN** im Tag- und im Nachtmodus die Lagekarte eines Einsatzes ohne verorteten Einsatzort
  geöffnet wird
- **THEN** zeigt das Paneel „Einsatzort“ „nicht verortet“ als Warntext
- **AND** er hält im Tag ≥ 7 : 1 und in der Nacht ≥ 5 : 1

#### Scenario: Kein abgeleiteter Ton
- **WHEN** die Theme-Tokens eines Modus mit dem Algorithmus dieses Modus aufgelöst werden
- **THEN** ist die Farbe für Warn- und für Erfolgstext genau der Wert der Textrolle ihres Status
  aus der Palette dieses Modus
- **AND** sie hält auf jeder deckenden Fläche im Tag ≥ 7 : 1 und in der Nacht ≥ 5 : 1
- **AND** die Füllfarben für Warnung und Erfolg bleiben die Statusrollen
