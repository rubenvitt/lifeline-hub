# Spec Delta

## MODIFIED Requirements

### Requirement: Hervorhebung aus vorhandenen Rollen

Die Markierung einer per Deeplink angesteuerten Zeile oder Karte einer Datensicht, eines
Zeitachseneintrags oder einer Kommunikationskarte (Meldung, Auftrag, Einsatzbefehl) MUST ihre Farben
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
- **WHEN** im Tag- oder Nachtmodus eine nicht alarmierte Meldung per `?meldung=`, ein nicht alarmierter Auftrag per `?auftrag=` oder ein Einsatzbefehl per `?befehl=` angesprungen wird
- **THEN** trägt die Karte die Fläche und die Linie der Bedienrollen des Modus, wie die Tabellenzeile

## ADDED Requirements

### Requirement: Markierung bleibt von der Auswahl unterscheidbar

In einer Fläche mit gewählter Karte (Muster „Liste + Detailpaneel“) MUST nur die angesprungene
Karte die Linie oben und unten tragen. Eine gewählte, nicht angesprungene Karte MUST NOT diese Linie
tragen. Trägt eine Karte beides, MUST die Markierung (Bedienfläche und Linie) über der Auswahlfläche
stehen.

#### Scenario: Gewählt, nicht angesprungen
- **WHEN** eine Karte von Hand gewählt ist und keine Karte angesprungen wurde
- **THEN** trägt die gewählte Karte die Auswahlfläche und keine Linie oben und unten

#### Scenario: Angesprungen und gewählt
- **WHEN** ein Auftrag per `?auftrag=` angesprungen und dadurch gewählt wird
- **THEN** trägt seine Karte die Bedienfläche und die Linie oben und unten
