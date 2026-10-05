# Spec Delta

## ADDED Requirements

### Requirement: Beschriftung auf Bedienfläche beim Drücken

Die Beschriftung eines gedrückten Primärknopfs SHALL denselben Textboden halten wie in Ruhe (Tag
≥ 7 : 1, Nacht ≥ 5 : 1). Beim Antippen ohne Zeiger ist das Drücken die einzige Rückmeldung des
Knopfs. Deshalb MUST sich die gedrückte Knopffläche von der Fläche in Ruhe unterscheiden, und es
MUST für diesen Zustand keinen eigenen, niedrigeren Boden geben.

#### Scenario: Primärknopf in der Nacht gedrückt
- **WHEN** im Nachtmodus ein Primärknopf gedrückt gehalten wird, etwa „Anmelden“ auf der
  Anmeldeseite
- **THEN** misst seine Beschriftung gegen die Knopffläche mindestens 5 : 1
- **AND** die Knopffläche hat eine andere Farbe als in Ruhe

#### Scenario: Primärknopf am Tag gedrückt
- **WHEN** im Tagmodus derselbe Primärknopf gedrückt gehalten wird
- **THEN** misst seine Beschriftung gegen die Knopffläche mindestens 7 : 1
- **AND** die Knopffläche hat eine andere Farbe als in Ruhe

## MODIFIED Requirements

### Requirement: Gefahrrot als Text hält den Textboden

Text, den die Anwendung als Gefahr rot zeichnet, SHALL im Tagmodus mindestens 7 : 1 und im
Nachtmodus mindestens 5 : 1 gegen den Grund halten, auf dem er steht. Das betrifft den roten
Eintrag eines Aktionsmenüs, die Beschriftung eines umrandeten Gefahrknopfs und die eines
Gefahrknopfs ohne Rahmen. Der Boden gilt in Ruhe, unter dem Zeiger und beim Drücken. Die Färbung
MUST app-weit aus einer Stelle kommen, kein Menü und kein Knopf MUST dafür eine eigene Farbe
setzen.

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

#### Scenario: Gefahrknopf ohne Rahmen gedrückt
- **WHEN** ein Gefahrknopf ohne Rahmen gedrückt gehalten wird, etwa „abgelehnt – prüfen“ im
  Live-Banner oder „Dokument entfernen“ in der Dokumentenliste
- **THEN** misst seine Beschriftung gegen die rote Hinterlegung des gedrückten Knopfs im Tag
  mindestens 7 : 1 und in der Nacht mindestens 5 : 1
- **AND** die Hinterlegung unterscheidet sich vom Grund in Ruhe
