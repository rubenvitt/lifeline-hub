# Spec Delta

## Purpose

Legt fest, welche Kontrastböden die Farbrollen der Tag- und der Nachtpalette tragen müssen,
damit Text und Bedienflächen bei Tageslicht im Freien und im abgedunkelten Fahrzeug lesbar
bleiben (Kriterium 5 der Prüfliste Einsatztauglichkeit).

## ADDED Requirements

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
