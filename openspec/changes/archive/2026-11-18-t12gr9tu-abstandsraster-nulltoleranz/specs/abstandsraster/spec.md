## ADDED Requirements

### Requirement: Abstände ohne Literal

Code MUST NOT einen Innen- oder Außenabstand oder eine Lücke als Zahl-Literal größer als 2 px setzen, weder im Stilobjekt noch als Abstandsangabe einer Layoutkomponente noch als px-Wert in handgeschriebenem CSS außerhalb der Rollenquelle. Die Prüfung SHALL keine Altlast dulden: Jede Datei außerhalb der festen Ausnahmen ist ohne ein solches Literal.

#### Scenario: Literal in einer Datei
- **WHEN** eine Datei außerhalb der festen Ausnahmen ein Abstands-Literal wie 8 oder `12px` bekommt
- **THEN** schlägt die Prüfung fehl und nennt Datei, Zeile und Wert

#### Scenario: Feinsatz
- **WHEN** ein Abstand 1 oder 2 px beträgt (Haarlinie, Symbolversatz) oder 0 ist
- **THEN** zählt er nicht als Abstands-Literal

## REMOVED Requirements

### Requirement: Keine neuen Abstands-Literale
**Reason**: Die Altlast ist abgebaut (LLH-1937); eine Schuld je Datei gibt es nicht mehr.
**Migration**: „Abstände ohne Literal“ übernimmt die Regel ohne Schuld; die Szenarien „Neues Literal“ und „Feinsatz“ gehen in „Literal in einer Datei“ und „Feinsatz“ auf, „Schuld sinkt“ entfällt.
