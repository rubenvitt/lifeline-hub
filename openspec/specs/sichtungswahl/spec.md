# sichtungswahl Specification

## Purpose
Legt fest, wie eine Sichtungskategorie nach BBK gewählt wird: in der Erfassung einer Person, bei
der Nachsichtung und überall, wo dieselbe Wahl eingebaut ist. Die Wahl muss mit einem Tipp, mit
Handschuh und bei Nacht sicher sitzen.

## Requirements

### Requirement: Jede Kategorie ist eine eigene Farbfläche

Die Sichtungswahl SHALL jede Kategorie als eigene Fläche in der Reihenfolge SK I, SK II, SK III,
SK IV, tot, unverletzt zeigen. Jede Fläche MUST das Kürzel groß und das Bedeutungswort darunter
tragen (akut, schwer, leicht, abwartend, verstorben, ohne Verletzung). SK I bis SK IV und tot
MUST in ihrer BBK-Farbe gefüllt sein. „unverletzt“ MUST ohne Sichtungsfarbe als neutrale Fläche
mit Rahmen erscheinen.

#### Scenario: Wahl vor der ersten Sichtung
- **WHEN** die Maske „Betroffene erfassen“ geöffnet ist und noch keine Kategorie gewählt wurde
- **THEN** stehen sechs Flächen in der Reihenfolge SK I, SK II, SK III, SK IV, tot, unverletzt
- **AND** SK I ist rot, SK II gelb, SK III grün, SK IV blau und tot schwarz gefüllt, und auf jeder
  Fläche stehen Kürzel und Bedeutungswort

#### Scenario: unverletzt ohne Farbe
- **WHEN** die Sichtungswahl angezeigt wird
- **THEN** trägt die Fläche „unverletzt“ keine Sichtungsfarbe, sondern die neutrale Fläche mit
  Rahmen

### Requirement: Die gewählte Kategorie ist ohne Farbe erkennbar

Ist eine Kategorie gewählt, SHALL ihre Fläche gefüllt bleiben und ein Häkchen sowie einen
kräftigen Rahmen tragen. Die übrigen Flächen MUST in eine Randform zurückfallen, in der die
Sichtungsfarbe nur als Kante oder Streifen erscheint, und MUST wählbar bleiben. Die Gruppe MUST
für Hilfstechnik als Auswahlgruppe „Sichtungskategorie“ benannt sein. Jede Fläche MUST als
Auswahl mit ihrem Zustand (gewählt oder nicht) angesagt werden.

#### Scenario: SK II gewählt
- **WHEN** jemand auf die Fläche „SK II“ tippt
- **THEN** trägt „SK II“ ein Häkchen und einen kräftigen Rahmen
- **AND** die übrigen fünf Flächen stehen in der Randform und lassen sich weiter wählen

#### Scenario: Ansage für Hilfstechnik
- **WHEN** ein Screenreader die Wahl mit gewählter Kategorie „SK I“ liest
- **THEN** sagt er eine Gruppe „Sichtungskategorie“ mit sechs Optionen an, von denen „SK I“
  gewählt ist

### Requirement: Tastatur und Abwahl

Die Sichtungswahl SHALL mit Pfeiltasten zwischen den Flächen wechseln und mit Leertaste oder
Enter wählen. In der Erfassung einer Person MUST ein zweiter Tipp auf die gewählte Fläche die Wahl
zurücknehmen, weil eine Erfassung ohne Sichtung erlaubt ist. Bei der Nachsichtung MUST die Wahl
nicht abwählbar sein.

#### Scenario: Wahl in der Erfassung zurücknehmen
- **WHEN** in der Maske „Betroffene erfassen“ „SK III“ gewählt ist und jemand erneut auf „SK III“
  tippt
- **THEN** ist keine Kategorie mehr gewählt, und die Person wird ohne Sichtung angelegt

#### Scenario: Wahl per Tastatur
- **WHEN** der Fokus auf der Fläche „SK I“ liegt und jemand zweimal die Pfeiltaste nach rechts und
  dann die Leertaste drückt
- **THEN** ist „SK III“ gewählt

### Requirement: Trefferfläche jeder Kategorie

Jede Fläche der Sichtungswahl SHALL in jeder Dichtestufe mindestens 72 px hoch und mindestens
96 px breit sein. Der Abstand zwischen zwei Flächen MUST in der Dichte `kompakt` mindestens 8 px
und in den Dichten `komfortabel` und `handschuh` mindestens 16 px betragen.

#### Scenario: Handschuh-Betrieb am UHS-Tablet
- **WHEN** am UHS-Tablet in der Dichte `handschuh` eine Person aufgenommen wird
- **THEN** ist jede Sichtungsfläche mindestens 72 px hoch und 96 px breit, und zwei Flächen liegen
  mindestens 16 px auseinander

#### Scenario: Kompakte Dichte am Fükw
- **WHEN** die Maske in der Dichte `kompakt` geöffnet ist
- **THEN** ist jede Sichtungsfläche trotzdem mindestens 72 px hoch

### Requirement: Nachsichtung ohne Dropdown

Die Nachsichtung einer angelegten Person SHALL dieselbe Sichtungswahl nutzen wie die Erfassung und
MUST höchstens zwei Tipps kosten: einen auf die Fläche und einen auf „Übernehmen“. Für die Wahl
der Sichtung MUST es kein Dropdown geben. „Bestätigt von“ am UHS-Gerät bleibt erhalten.

#### Scenario: Nachsichtung auf der Detailseite
- **WHEN** jemand auf der Detailseite einer Person die Nachsichtung öffnet, „SK I“ tippt und
  „Übernehmen“ wählt
- **THEN** ist die Sichtung SK I gespeichert, und dafür waren nach dem Öffnen zwei Tipps nötig

#### Scenario: Nachsichtung am UHS-Tablet
- **WHEN** am UHS-Tablet die Nachsichtung geöffnet wird
- **THEN** steht die Sichtungswahl mit Flächen und darunter das Feld „Bestätigt von“
