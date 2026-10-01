# Spec Delta

## Purpose

Legt fest, wie eine per Deeplink angesteuerte Zeile oder Karte einer Datensicht oder ein
Eintrag einer Zeitachse (ETB, Infotelefon) markiert wird:
aus vorhandenen Farbrollen, in beiden Modi sichtbar und unterscheidbar von Hover, Fokus und
Statustönungen, ohne den Kontrastboden des Zeilentexts zu unterschreiten.

## ADDED Requirements

### Requirement: Hervorhebung aus vorhandenen Rollen

Die Markierung einer per Deeplink angesteuerten Zeile oder Karte einer Datensicht oder eines
Zeitachseneintrags MUST ihre Farben ausschließlich
aus vorhandenen Farbrollen beziehen. Sie MUST NOT eine Statusrolle (`achtung`, `alarm`, `normal`)
oder eine Statustönung einer Zeile verwenden, weil die angesprungene Zeile kein Zustand ist.

#### Scenario: Keine Farbe außerhalb der Rollen
- **WHEN** im Tag- oder Nachtmodus eine Zeile per Deeplink angesprungen wird
- **THEN** stimmen Fläche und Linie der Markierung mit den Werten der Bedienrollen des Modus überein

#### Scenario: Kein Warnton
- **WHEN** eine Zeile ohne eigene Statustönung per Deeplink angesprungen wird
- **THEN** fügt die Markierung weder die Achtung- noch die Alarmfläche, noch eine Lücken-, Problem- oder Berichtigungstönung hinzu

### Requirement: Zwei Kanäle, in beiden Modi sichtbar

Die Markierung MUST neben einer getönten Fläche einen zweiten Kanal tragen, eine Linie oben und
unten an der Zeile bzw. Karte. Die Linie MUST gegen die Markierungsfläche und gegen die Fläche der
Nachbarzeile mindestens 3 : 1 halten, im Tag- wie im Nachtmodus.

#### Scenario: Nachts sichtbar
- **WHEN** im Nachtmodus eine Tabellenzeile per Deeplink angesprungen wird
- **THEN** misst die Linie gegen die Markierungsfläche und gegen die Fläche der Nachbarzeile jeweils mindestens 3 : 1

#### Scenario: Am Tag sichtbar
- **WHEN** im Tagmodus eine Tabellenzeile per Deeplink angesprungen wird
- **THEN** misst die Linie gegen die Markierungsfläche und gegen die Fläche der Nachbarzeile jeweils mindestens 3 : 1

#### Scenario: Kartenzweig unter md
- **WHEN** auf schmalem Schirm (Kartenform der Datensicht) eine Karte per Deeplink angesprungen wird
- **THEN** trägt die Karte dieselbe Fläche und dieselbe Linie wie die Tabellenzeile

### Requirement: Unterscheidbar von Hover und Fokus

Die Markierung MUST sich von einer gehoverten Zeile und vom Fokusring unterscheiden. Eine
gehoverte, nicht markierte Zeile MUST NOT die Linie der Markierung tragen. Die Markierung MUST
NOT als umlaufender Rahmen in Bedienfarbe erscheinen, weil das die Form des Fokusrings ist.

#### Scenario: Gehoverte Nachbarzeile
- **WHEN** der Zeiger über einer nicht markierten Zeile derselben Tabelle steht
- **THEN** hat diese Zeile eine andere Fläche als die markierte Zeile und keine Linie oben und unten

#### Scenario: Markierte Zeile unter dem Zeiger
- **WHEN** der Zeiger über der markierten Zeile steht
- **THEN** trägt sie weiter die Linie oben und unten

### Requirement: Zeilentext hält den Textboden

Der Text einer markierten Zeile oder Karte MUST gegen die tatsächlich komponierte Fläche, auf der
er steht, im Tagmodus mindestens 7 : 1 und im Nachtmodus mindestens 5 : 1 halten.

#### Scenario: Text am Tag
- **WHEN** im Tagmodus eine Zeile per Deeplink angesprungen wird
- **THEN** misst ihr Zellentext gegen die komponierte Zellfläche mindestens 7 : 1

#### Scenario: Text in der Nacht
- **WHEN** im Nachtmodus eine Zeile per Deeplink angesprungen wird
- **THEN** misst ihr Zellentext gegen die komponierte Zellfläche mindestens 5 : 1
