# farbrollen-kontrast Specification

## Purpose
Legt fest, welche Kontrastböden die Farbrollen der Tag- und der Nachtpalette tragen müssen,
damit Text und Bedienflächen bei Tageslicht im Freien und im abgedunkelten Fahrzeug lesbar
bleiben (Kriterium 5 der Prüfliste Einsatztauglichkeit).

## Requirements

### Requirement: Beschriftung auf Bedienfläche hält den Textboden

Die Beschriftung eines Primärknopfs (Text auf satter Bedienfläche) SHALL den Textboden aus
Kriterium 5 halten: im Tagmodus mindestens 7 : 1, im Nachtmodus mindestens 5 : 1. Für diese
Beschriftung MUST es keinen eigenen, niedrigeren Boden geben, auch nicht wegen ihres
Schriftgewichts.

#### Scenario: Primärknopf am Tag in Ruhe
- **WHEN** im Tagmodus ein Primärknopf ohne Zeiger und ohne Fokus angezeigt wird
- **THEN** misst seine Beschriftung gegen die Knopffläche mindestens 7 : 1

#### Scenario: Primärknopf in der Nacht in Ruhe
- **WHEN** im Nachtmodus ein Primärknopf ohne Zeiger und ohne Fokus angezeigt wird
- **THEN** misst seine Beschriftung gegen die Knopffläche mindestens 5 : 1

#### Scenario: Kontrastnachweis einer Seite ohne Ausnahme
- **WHEN** ein Kontrastnachweis einer Seite oder eines Dialogs die Beschriftung eines
  Primärknopfs misst
- **THEN** prüft er sie gegen den vollen Textboden des Modus und führt sie unter keiner
  Ausnahme mit niedrigerer Schranke

### Requirement: Beschriftung auf Bedienfläche unter dem Zeiger

Die Beschriftung eines Primärknopfs unter dem Zeiger SHALL denselben Textboden halten wie in
Ruhe (Tag ≥ 7 : 1, Nacht ≥ 5 : 1). Die Knopffläche unter dem Zeiger MUST sich von der Fläche in
Ruhe unterscheiden, damit der Zeigerzustand sichtbar bleibt.

#### Scenario: Primärknopf am Tag unter dem Zeiger
- **WHEN** im Tagmodus der Zeiger über einem Primärknopf steht
- **THEN** misst seine Beschriftung gegen die Knopffläche mindestens 7 : 1
- **AND** die Knopffläche hat eine andere Farbe als in Ruhe

#### Scenario: Primärknopf in der Nacht unter dem Zeiger
- **WHEN** im Nachtmodus der Zeiger über einem Primärknopf steht
- **THEN** misst seine Beschriftung gegen die Knopffläche mindestens 5 : 1
- **AND** die Knopffläche hat eine andere Farbe als in Ruhe

### Requirement: Gefahrrot als Text hält den Textboden

Text, den die Anwendung als Gefahr rot zeichnet, SHALL im Tagmodus mindestens 7 : 1 und im
Nachtmodus mindestens 5 : 1 gegen den Grund halten, auf dem er steht. Das betrifft den roten
Eintrag eines Aktionsmenüs, die Beschriftung eines umrandeten Gefahrknopfs und die eines
Gefahrknopfs ohne Rahmen. Der Boden gilt in Ruhe und unter dem Zeiger. Die Färbung MUST app-weit
aus einer Stelle kommen, kein Menü und kein Knopf MUST dafür eine eigene Farbe setzen.

#### Scenario: Roter Menüeintrag am Tag in Ruhe
- **WHEN** im Tagmodus ein Aktionsmenü mit einem roten Eintrag „Löschen“ geöffnet ist und der
  Zeiger nicht über dem Eintrag steht
- **THEN** misst der Eintrag gegen die Menüfläche mindestens 7 : 1

#### Scenario: Roter Menüeintrag in der Nacht in Ruhe
- **WHEN** im Nachtmodus dasselbe Menü geöffnet ist
- **THEN** misst der Eintrag gegen die Menüfläche mindestens 5 : 1

#### Scenario: Umrandeter Gefahrknopf unter dem Zeiger
- **WHEN** der Zeiger über einem umrandeten Gefahrknopf steht, etwa „Deaktivieren“ in einem
  Katalog der Stammdaten
- **THEN** misst seine Beschriftung gegen die Knopffläche im Tag mindestens 7 : 1 und in der
  Nacht mindestens 5 : 1

### Requirement: Beschriftung auf Gefahrfläche hält den Textboden

Die Beschriftung eines gefüllten Gefahrknopfs (Text auf satter Gefahrfläche, etwa der
Bestätigungsknopf einer Rückfrage) und die Beschriftung des roten Menüeintrags unter dem Zeiger
SHALL im Tagmodus mindestens 7 : 1 und im Nachtmodus mindestens 5 : 1 halten, in Ruhe, unter dem
Zeiger und beim Drücken. Für diese Beschriftung MUST es keinen eigenen, niedrigeren Boden geben.
Die Gefahrfläche unter dem Zeiger MUST sich von der Fläche in Ruhe unterscheiden.

#### Scenario: Gefahrknopf am Tag in Ruhe
- **WHEN** im Tagmodus die Rückfrage „Löschen“ eines Zeitfensters der Verpflegung offen ist und
  der Zeiger nicht über ihrem roten Bestätigungsknopf steht
- **THEN** misst dessen Beschriftung gegen die Knopffläche mindestens 7 : 1

#### Scenario: Gefahrknopf unter dem Zeiger
- **WHEN** der Zeiger über dem roten Bestätigungsknopf steht, im Tag- oder im Nachtmodus
- **THEN** misst seine Beschriftung gegen die Knopffläche mindestens 7 : 1 (Tag) beziehungsweise
  5 : 1 (Nacht)
- **AND** die Knopffläche hat eine andere Farbe als in Ruhe

#### Scenario: Roter Menüeintrag unter dem Zeiger in der Nacht
- **WHEN** im Nachtmodus der Zeiger über dem roten Eintrag eines geöffneten Aktionsmenüs steht
- **THEN** misst seine Beschriftung gegen die rote Hinterlegung mindestens 5 : 1

#### Scenario: Kontrastnachweis einer Seite ohne Ausnahme
- **WHEN** ein Kontrastnachweis einer Seite oder eines Dialogs einen roten Menüeintrag oder die
  Beschriftung eines Gefahrknopfs misst
- **THEN** prüft er sie gegen den vollen Textboden des Modus und führt sie unter keiner
  Ausnahme mit niedrigerer Schranke
