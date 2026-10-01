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

### Requirement: Angesteuerte Zeile trägt eine eigene Zeilentönung

Eine per Deeplink angesteuerte Zeile oder Karte SHALL eine eigene Zeilentönung tragen, die aus
einer Farbrolle kommt. Die Tönung MUST sich in beiden Modi farblich von der Fläche einer Zeile
unter dem Zeiger und von den übrigen Zeilentönungen (Berichtigung, Lücke, Problem) unterscheiden.
Sie MUST auch in einer Tabelle tatsächlich als Grund der Zellen stehen.

#### Scenario: Angesteuerte Tabellenzeile ohne Zeiger
- **WHEN** eine Seite mit Tabelle über einen Deeplink auf eine Zeile geöffnet wird und kein Zeiger über der Zeile steht
- **THEN** tragen die Zellen dieser Zeile die Hervorhebungstönung des Modus als Hintergrund

#### Scenario: Angesteuerte Karte einer Zeitachse
- **WHEN** das Einsatztagebuch oder das Anrufprotokoll des Infotelefons über einen Deeplink auf einen Eintrag geöffnet wird
- **THEN** trägt die Karte dieses Eintrags die Hervorhebungstönung des Modus als Grund

#### Scenario: Vorrang vor einer anderen Zeilentönung
- **WHEN** der angesteuerte Eintrag zugleich eine andere Zeilentönung trüge, etwa als Berichtigung
- **THEN** trägt er die Hervorhebungstönung, solange er angesteuert ist

#### Scenario: Unterscheidbar vom Zeiger
- **WHEN** im Tag- oder Nachtmodus eine nicht angesteuerte Zeile unter dem Zeiger steht
- **THEN** hat ihre Fläche eine andere Farbe als die Hervorhebungstönung desselben Modus

#### Scenario: Unterscheidbar von der Lückentönung
- **WHEN** eine Tabelle zugleich eine angesteuerte Zeile und eine Zeile mit Lückentönung zeigt
- **THEN** tragen beide Zeilen verschiedene Hintergrundfarben

### Requirement: Zeilentext hält den Textboden auf der Hervorhebung

Text in einer angesteuerten Zeile SHALL auf der Hervorhebungstönung den Textboden aus Kriterium 5
halten: im Tagmodus mindestens 7 : 1, im Nachtmodus mindestens 5 : 1. Das gilt für Grundtext,
Lauftext, gedämpften Text, blauen Bedientext und die Textrollen der Status. Gemessen wird gegen
den tatsächlich komponierten Grund der Zelle.

#### Scenario: Tagmodus
- **WHEN** im Tagmodus eine angesteuerte Tabellenzeile ohne Zeiger angezeigt wird
- **THEN** misst ihr Kennungs- und Lauftext gegen den Grund der Zelle mindestens 7 : 1

#### Scenario: Nachtmodus
- **WHEN** im Nachtmodus eine angesteuerte Tabellenzeile ohne Zeiger angezeigt wird
- **THEN** misst ihr Kennungs- und Lauftext gegen den Grund der Zelle mindestens 5 : 1
