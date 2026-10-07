## ADDED Requirements

### Requirement: Eine allgemeine Maske für Betroffene

Die Betroffenenliste MUST genau eine allgemeine Erfassungsmaske anbieten, dazu „Vermisst melden“.
Der Knopf im Seitenkopf und der Einstieg der Sprungpalette (`?neu=1`) MUST dieselbe Maske öffnen.
Eine über diese Maske erfasste Person MUST den Status „erfasst“ erhalten, unabhängig davon, über
welchen Einstieg die Maske geöffnet wurde; mit einer Sichtung hebt der Server sie wie bisher auf
„betroffen“. Die Maske MUST den Status, den die Person erhält, sichtbar nennen, samt dem Hinweis,
dass eine Sichtung sie zu „betroffen“ macht. „Vermisst melden“ bleibt ein eigener Weg mit dem
Status „vermisst“.

#### Scenario: Beide Einstiege, eine Maske
- **WHEN** die Maske einmal über den Kopfknopf und einmal über `?neu=1` geöffnet wird
- **THEN** tragen beide denselben Titel und dieselben Felder, und eine ohne Sichtung erfasste Person wird mit Status „erfasst“ angelegt

#### Scenario: Folgestatus sichtbar
- **WHEN** die allgemeine Maske geöffnet ist
- **THEN** steht im Dialog sichtbar, dass die Person als „erfasst“ angelegt wird und mit Sichtung als „betroffen“ gilt

#### Scenario: Kein zweiter allgemeiner Weg
- **WHEN** ein Benutzer mit Schreibrecht die Betroffenenliste öffnet
- **THEN** gibt es im Seitenkopf genau einen Knopf, der die allgemeine Maske öffnet, und keinen Knopf „Schnellerfassung“ oder „Betroffene/n erfassen“

### Requirement: Statusfilter und Tabelle nennen den Status gleich

Der Statusfilter der Betroffenenliste MUST jeden Personenstatus mit demselben Wort nennen wie die
Statusspalte der Tabelle. Der Status `erfasst` heißt im Filter „Erfasst“, nicht „Neu“.

#### Scenario: Filter „Erfasst“
- **WHEN** der Statusfilter der Betroffenenliste angezeigt wird
- **THEN** heißt das Segment für den Status `erfasst` „Erfasst“, und kein Segment heißt „Neu“

### Requirement: Tiere-Erfassung hält das Feldbudget

Die Erfassung eines Tieres auf der Tiere-Liste MUST in beiden Modi (Erfassen und „Vermisst
melden“) höchstens vier Eingabefelder sichtbar zeigen. Alle weiteren Felder MUST unter einem
aufklappbaren Bereich „Weitere Angaben“ stehen, der beim Aufklappen mehr Felder sichtbar macht.
Ein Pflichtfeld MUST nie hinter dem aufklappbaren Bereich stehen.

#### Scenario: Erfassen
- **WHEN** die Tiere-Erfassung geöffnet ist
- **THEN** sind höchstens vier Eingabefelder sichtbar, darunter Spezies und Antreffort, und nach dem Aufklappen von „Weitere Angaben“ sind es mehr

#### Scenario: Vermisst melden
- **WHEN** „Vermisst melden“ auf der Tiere-Liste geöffnet ist
- **THEN** sind höchstens vier Eingabefelder sichtbar, und Farbe, Kennzeichnung und Halter-Kontakt erscheinen erst nach dem Aufklappen von „Weitere Angaben“
