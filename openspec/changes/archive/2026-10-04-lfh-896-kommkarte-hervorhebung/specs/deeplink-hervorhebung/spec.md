## MODIFIED Requirements

### Requirement: Hervorhebung aus vorhandenen Rollen

Die Markierung einer per Deeplink angesteuerten Zeile oder Karte einer Datensicht, eines
Zeitachseneintrags oder einer Kommunikationskarte (Meldung, Auftrag) MUST ihre Farben
ausschließlich aus vorhandenen Farbrollen beziehen. Sie MUST NOT eine Statusrolle (`achtung`,
`alarm`, `normal`) oder eine Statustönung einer Zeile verwenden, weil die angesprungene Zeile
kein Zustand ist.

#### Scenario: Keine Farbe außerhalb der Rollen
- **WHEN** im Tag- oder Nachtmodus eine Zeile per Deeplink angesprungen wird
- **THEN** stimmen Fläche und Linie der Markierung mit den Werten der Bedienrollen des Modus überein

#### Scenario: Kein Warnton
- **WHEN** eine Zeile ohne eigene Statustönung per Deeplink angesprungen wird
- **THEN** fügt die Markierung weder die Achtung- noch die Alarmfläche, noch eine Lücken-, Problem- oder Berichtigungstönung hinzu

#### Scenario: Kommunikationskarte
- **WHEN** im Tag- oder Nachtmodus eine nicht alarmierte Meldung per `?meldung=` oder ein nicht alarmierter Auftrag per `?auftrag=` angesprungen wird
- **THEN** trägt die Karte die Fläche und die Linie der Bedienrollen des Modus, wie die Tabellenzeile

### Requirement: Unterscheidbar von Hover und Fokus

Die Markierung MUST sich von einer gehoverten Zeile und vom Fokusring unterscheiden. Eine
gehoverte, nicht markierte Zeile MUST NOT die Linie der Markierung tragen. Die Markierung MUST
NOT als umlaufender Rahmen oder Ring in Bedienfarbe erscheinen, weil das die Form des
Fokusrings ist; das gilt auch für Kommunikationskarten.

#### Scenario: Gehoverte Nachbarzeile
- **WHEN** der Zeiger über einer nicht markierten Zeile derselben Tabelle steht
- **THEN** hat diese Zeile eine andere Fläche als die markierte Zeile und keine Linie oben und unten

#### Scenario: Markierte Zeile unter dem Zeiger
- **WHEN** der Zeiger über der markierten Zeile steht
- **THEN** trägt sie weiter die Linie oben und unten

#### Scenario: Kein Ring an der Kommunikationskarte
- **WHEN** eine Meldung oder ein Auftrag per Deeplink angesprungen wird
- **THEN** trägt die Karte genau eine Linie oben und eine unten und keinen umlaufenden Ring

## ADDED Requirements

### Requirement: Gefahr gewinnt an der markierten Karte

Trägt eine angesprungene Karte einen Gefahrzustand mit eigener Fläche (alarmierte
Kommunikationskarte), MUST die Markierung diese Fläche und die linke Statuskante stehen lassen
und nur die Linie oben und unten hinzufügen. Die Linie MUST gegen die Gefahrfläche mindestens
3 : 1 halten, im Tag- wie im Nachtmodus.

#### Scenario: Alarmierte Karte angesprungen
- **WHEN** im Tag- oder Nachtmodus ein überfälliger Auftrag per `?auftrag=` angesprungen wird
- **THEN** steht die Karte weiter auf der Alarmfläche mit Alarmkante links und trägt die Linie oben und unten in `bedien`

#### Scenario: Linie auf der Alarmfläche
- **WHEN** eine alarmierte Karte per Deeplink angesprungen wird
- **THEN** misst die Linie gegen die Alarmfläche mindestens 3 : 1
