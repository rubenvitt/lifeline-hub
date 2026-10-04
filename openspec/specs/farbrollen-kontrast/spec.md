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

### Requirement: Rand eines Steuerelements auf einer Hinweisfläche

Der Rand eines Steuerelements, das auf einer Hinweisfläche steht (Info, Warnung, Fehler,
Erfolg), SHALL im Tag- und im Nachtmodus gegen diese Hinweisfläche mindestens 3 : 1 halten
(WCAG 1.4.11). Gegen die eigene Fläche des Steuerelements gilt derselbe Boden. Kein
Kontrastnachweis MUST diesen Rand unter einer Ausnahme mit niedrigerer Schranke führen.

#### Scenario: Knopf auf einem Info-Hinweis am Tag
- **WHEN** im Tagmodus die Einsatzliste den Hinweis „Demo-Daten sind freigeschaltet und noch
  nicht importiert.“ mit dem Knopf „Zu den Demo-Daten“ zeigt
- **THEN** misst der Knopfrand gegen die Hinweisfläche mindestens 3 : 1
- **AND** gegen die Knopffläche mindestens 3 : 1

#### Scenario: Knopf auf einem Info-Hinweis in der Nacht
- **WHEN** im Nachtmodus derselbe Hinweis angezeigt wird
- **THEN** misst der Knopfrand gegen die Hinweisfläche und gegen die Knopffläche jeweils
  mindestens 3 : 1

#### Scenario: Knopf auf einem Fehlerhinweis
- **WHEN** eine Seite nach einem Ladefehler einen Fehlerhinweis mit dem Knopf „Erneut abrufen“
  oder „Erneut laden“ zeigt
- **THEN** misst der Knopfrand gegen die Hinweisfläche im Tag- und im Nachtmodus mindestens 3 : 1

#### Scenario: Warn- und Erfolgshinweis
- **WHEN** ein Steuerelement auf einem Warn- oder Erfolgshinweis steht
- **THEN** misst sein Rand gegen die Hinweisfläche im Tag- und im Nachtmodus mindestens 3 : 1

### Requirement: Hinweisflächen kommen aus den Statusflächen

Die Fläche eines Hinweises SHALL in beiden Modi die Statusfläche seiner Bedeutung tragen: Info
die Bedienfläche, Warnung die Achtungsfläche, Fehler die Alarmfläche, Erfolg die Normalfläche.
Die Zuordnung MUST app-weit aus einer Stelle kommen; kein Hinweis MUST dafür eine eigene Farbe
setzen. Text auf der Hinweisfläche hält dabei den Textboden (Tag ≥ 7 : 1, Nacht ≥ 5 : 1).

#### Scenario: Info-Hinweis trägt die Bedienfläche
- **WHEN** ein Info-Hinweis im Tag- oder im Nachtmodus angezeigt wird
- **THEN** ist seine Fläche dieselbe Farbe wie die Bedienfläche des Modus

#### Scenario: Text auf dem Hinweis
- **WHEN** ein Hinweis Titel und Beschreibung zeigt
- **THEN** misst der Text gegen die Hinweisfläche im Tag mindestens 7 : 1 und in der Nacht
  mindestens 5 : 1

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
