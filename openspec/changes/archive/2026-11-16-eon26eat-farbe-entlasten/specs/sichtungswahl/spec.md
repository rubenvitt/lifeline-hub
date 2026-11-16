# Spec Delta

## MODIFIED Requirements

### Requirement: Jede Kategorie ist eine eigene Farbfläche

Die Sichtungswahl SHALL jede Kategorie als eigene Fläche in der Reihenfolge SK I, SK II, SK III,
SK IV, tot, unverletzt zeigen. Jede Fläche MUST das Kürzel groß und das Bedeutungswort darunter
tragen (akut, schwer, leicht, abwartend, verstorben, ohne Verletzung). SK I bis SK IV und tot
MUST in ihrer BBK-Farbe gefüllt sein; „tot“ trägt zusätzlich eine Schraffur. „unverletzt“ MUST
ohne Sichtungsfarbe und ohne eigene Fläche erscheinen: nur Rahmen, Kürzel und Wort auf dem Grund
der Maske.

#### Scenario: Wahl vor der ersten Sichtung
- **WHEN** die Maske „Betroffene erfassen“ geöffnet ist und noch keine Kategorie gewählt wurde
- **THEN** stehen sechs Flächen in der Reihenfolge SK I, SK II, SK III, SK IV, tot, unverletzt
- **AND** SK I ist rot, SK II gelb, SK III grün, SK IV blau und tot schwarz mit Schraffur
  gefüllt, und auf jeder Fläche stehen Kürzel und Bedeutungswort

#### Scenario: unverletzt ohne Farbe
- **WHEN** die Sichtungswahl angezeigt wird
- **THEN** trägt „unverletzt“ keine Sichtungsfarbe und keine eigene Fläche, sondern nur einen
  Rahmen auf dem Grund der Maske

### Requirement: Die gewählte Kategorie ist ohne Farbe erkennbar

Ist eine Kategorie gewählt, SHALL ihre Fläche gefüllt bleiben und ein Häkchen sowie einen
kräftigen Rahmen tragen. Die übrigen Flächen MUST ihre Sichtungsfarbe behalten, abgeschwächt als
farbiger Innenrahmen mit getönter Fläche, und MUST wählbar bleiben. Ein schmaler Streifen allein
reicht dafür nicht. Die Gruppe MUST für Hilfstechnik als Auswahlgruppe „Sichtungskategorie“
benannt sein. Jede Fläche MUST als Auswahl mit ihrem Zustand (gewählt oder nicht) angesagt werden.

#### Scenario: SK II gewählt
- **WHEN** jemand auf die Fläche „SK II“ tippt
- **THEN** trägt „SK II“ ein Häkchen und einen kräftigen Rahmen
- **AND** die übrigen fünf Flächen tragen ihre Sichtungsfarbe als Innenrahmen mit Tönung und
  lassen sich weiter wählen

#### Scenario: Fehlwahl korrigieren
- **WHEN** „SK III“ gewählt ist und jemand „SK I“ sucht
- **THEN** ist „SK I“ an ihrem roten Innenrahmen zu finden, ohne die Beschriftung zu lesen

#### Scenario: Ansage für Hilfstechnik
- **WHEN** ein Screenreader die Wahl mit gewählter Kategorie „SK I“ liest
- **THEN** sagt er eine Gruppe „Sichtungskategorie“ mit sechs Optionen an, von denen „SK I“
  gewählt ist

## ADDED Requirements

### Requirement: „tot“ und „unverletzt“ sind ohne Lesen unterscheidbar

„tot“ und „unverletzt“ SHALL im Tag- und im Nachtmodus, vor und nach einer Wahl, an ihrer Form
unterscheidbar sein, ohne die Beschriftung zu lesen: „tot“ trägt in jedem Zustand eine
Schraffur, „unverletzt“ trägt keine Fläche und keine Schraffur.

#### Scenario: Nacht vor der Wahl
- **WHEN** im Nachtmodus die Sichtungswahl ohne Wahl geöffnet ist
- **THEN** trägt „tot“ eine Schraffur und „unverletzt“ keine

#### Scenario: Nacht nach Wahl einer anderen Kategorie
- **WHEN** im Nachtmodus „SK I“ gewählt ist
- **THEN** trägt „tot“ weiter seine Schraffur, „unverletzt“ weiter keine

### Requirement: Der Startfokus liegt auf der Gruppe

Beim Öffnen der Erfassung und nach jedem Serien-Speichern SHALL der Fokus auf der Gruppe der
Sichtungswahl liegen, nicht auf einer einzelnen Kategorie, damit nichts wie vorausgewählt
aussieht. Von der Gruppe aus MUST eine Pfeiltaste die gewählte Kategorie ansteuern, ohne Wahl die
erste.

#### Scenario: Maske öffnen
- **WHEN** die Maske „Betroffene erfassen“ geöffnet wird
- **THEN** liegt der Fokus auf der Gruppe „Sichtungskategorie“, und keine Kachel trägt einen
  Fokusring

#### Scenario: Von der Gruppe zur Kategorie
- **WHEN** der Fokus auf der Gruppe liegt, keine Kategorie gewählt ist und jemand die Pfeiltaste
  nach rechts drückt
- **THEN** liegt der Fokus auf „SK I“, und noch ist nichts gewählt
