## ADDED Requirements

### Requirement: Statustext in der Textrolle des Status

Text, den antd als Fehler, Warnung oder Erfolg auszeichnet (darunter `Typography` vom Typ
`danger`, `warning` und `success`, auch als Link unter dem Zeiger und beim Drücken), MUST die
Textrolle des Status tragen (`alarm`, `achtung` beziehungsweise `normal` als Text), nicht die
Füllfarbe und keinen von antd abgeleiteten Ton. Er MUST den Boden der Spec halten. Kante, Badge,
Ikone und Gefahrknopf bleiben bei der Füllfarbe.

#### Scenario: Fehlertext auf dem Seitengrund
- **WHEN** im Tag- und im Nachtmodus die Detailseite eines Befehls aufgerufen wird, den es nicht
  gibt
- **THEN** erscheint „Befehl nicht gefunden.“ als Fehlertext
- **AND** er hält im Tag ≥ 7 : 1 und in der Nacht ≥ 5 : 1

#### Scenario: Warntext in der Leiste der Lagekarte
- **WHEN** im Tag- und im Nachtmodus die Lagekarte eines Einsatzes ohne verorteten Einsatzort
  geöffnet wird
- **THEN** zeigt das Paneel „Einsatzort“ „nicht verortet“ als Warntext
- **AND** er hält im Tag ≥ 7 : 1 und in der Nacht ≥ 5 : 1

#### Scenario: Kein abgeleiteter Ton
- **WHEN** die Theme-Tokens eines Modus mit dem Algorithmus dieses Modus aufgelöst werden
- **THEN** ist jede Statustextfarbe in Ruhe, unter dem Zeiger und gedrückt genau der Wert der
  Textrolle ihres Status aus der Palette dieses Modus
- **AND** die Füllfarben für Fehler, Warnung und Erfolg bleiben die Statusrollen
