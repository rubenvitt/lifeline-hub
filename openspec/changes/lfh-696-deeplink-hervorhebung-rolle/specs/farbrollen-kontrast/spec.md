# Spec Delta

## ADDED Requirements

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
