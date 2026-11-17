# Spec Delta

## ADDED Requirements

### Requirement: Das gewählte Segment trägt eine Bedienkante

Das gewählte Segment einer Segmentleiste SHALL zusätzlich zu seiner Fläche eine 2 px hohe Kante
am unteren Rand in der Bedienfarbe tragen, in beiden Modi. Die Kante MUST bei voller Helligkeit
mindestens 3 : 1 gegen die Fläche des Segments halten. Sie MUST sich vom Fokusring (Rahmen
ringsum) unterscheiden. Trägt ein Segment eine eigene Typkante, ersetzt diese die Bedienkante.

#### Scenario: Filter in der Nacht gewählt
- **WHEN** im Nachtmodus in einer Segmentleiste „Offen“ gewählt ist
- **THEN** trägt „Offen“ unten eine 2-px-Kante in der Bedienfarbe, die übrigen Segmente nicht
- **AND** die Kante misst gegen die Fläche des Segments mindestens 3 : 1

#### Scenario: Gedimmte Anzeige
- **WHEN** der Helligkeitsregler auf 20 % steht
- **THEN** ist das gewählte Segment weiterhin an der Kante erkennbar, nicht nur an der Fläche

#### Scenario: Gewählter ETB-Typ
- **WHEN** im ETB der Filter „Meldung“ gewählt ist
- **THEN** trägt das Segment unten seine Typkante und keine zweite Kante

### Requirement: Vier Flächenstufen mit Mindestabstand

Die Oberfläche SHALL je Modus höchstens vier verschiedene Flächenwerte für Seitengrund, Paneel,
Kopfband und hervorgehobene Fläche nutzen. Zwei benachbarte Stufen MUST bei voller Helligkeit
mindestens 1,10 : 1 auseinanderliegen, im Tag- und im Nachtmodus. Eine Qualitätsprüfung MUST
fehlschlagen, wenn ein fünfter Flächenwert hinzukommt oder ein Schritt den Abstand unterschreitet.

#### Scenario: Paneel-Kopf auf dem Paneel bei Nacht
- **WHEN** im Nachtmodus ein Paneel mit Kopfband angezeigt wird
- **THEN** hebt sich das Kopfband vom Paneel mit mindestens 1,10 : 1 ab

#### Scenario: Neue Flächenrolle
- **WHEN** eine Änderung eine Flächenrolle mit einem fünften Wert einführt
- **THEN** schlägt die Qualitätsprüfung fehl und nennt die Rolle

### Requirement: Die Ortsmarke im Rahmen trägt die Bedienfarbe

Die Marke, die im Rahmen die aktive Stelle zeigt (aktive Kategorie der Rail, offene Kategorie im
Navigations-Drawer, aktiver Reiter der Gerätehülle), SHALL die Bedienfarbe tragen, wie die Marke
des aktiven Moduls im Modulpanel. Sie MUST gegen ihre Fläche mindestens 3 : 1 halten und MUST NOT
rot sein.

#### Scenario: Aktive Rail-Kategorie
- **WHEN** im Einsatz die Kategorie „Kräfte“ aktiv ist
- **THEN** trägt ihr Rail-Ziel eine Marke in der Bedienfarbe mit mindestens 3 : 1 gegen die
  Fläche des Ziels

#### Scenario: Gerätehülle
- **WHEN** an einem gekoppelten Gerät der Reiter „Lage“ aktiv ist
- **THEN** ist seine Marke in der Bedienfarbe, nicht rot

## MODIFIED Requirements

### Requirement: Sichtungsfläche hält den Textboden

Text auf einer gefüllten Fläche der Sichtungswahl (SK I, SK II, SK III, SK IV, tot) SHALL im
Tagmodus mindestens 7 : 1 und im Nachtmodus mindestens 5 : 1 gegen die Fläche halten. Das gilt
auch für die getönte Fläche einer nicht gewählten Kachel nach einer Wahl und für den Text auf der
Schraffur von „tot“. Die Kante jeder Fläche MUST im Tag- und im Nachtmodus gegen den Grund, auf
dem sie steht, mindestens 3 : 1 halten. Das betrifft insbesondere Gelb auf hellem und Rot, Blau,
Grün und Schwarz auf dunklem Grund. Die Flächentöne MUST aus einer Stelle kommen und den
BBK-Farbton eindeutig erkennen lassen. Für Sichtungsflächen MUST es keine Großschrift-Ausnahme mit
niedrigerem Boden geben.

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

#### Scenario: Getönte Kachel nach einer Wahl
- **WHEN** im Nachtmodus „SK II“ gewählt ist und „SK I“ als nicht gewählte Kachel getönt steht
- **THEN** misst der Text von „SK I“ gegen ihre getönte Fläche mindestens 5 : 1
