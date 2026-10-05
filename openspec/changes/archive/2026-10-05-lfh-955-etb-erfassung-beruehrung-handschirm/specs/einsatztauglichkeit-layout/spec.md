## MODIFIED Requirements

### Requirement: Die Erfassungsleiste des ETB lässt die Zeitachse sichtbar

Die angepinnte Erfassungsleiste des ETB MUST im Ruhezustand (leerer Entwurf, keine Felder
gesetzt, Menüs geschlossen) höchstens die Hälfte der Fensterhöhe belegen und schon ganz oben
auf der Seite vollständig im Fenster stehen. Das gilt auf Handschirm, Führungs-Tablet und
Fükw in allen drei Dichtestufen. Das Textfeld MUST auf dem Handschirm die volle Breite der
Leiste nutzen und ab `md` die Zeile zwischen Typ-Präfix und den Knöpfen füllen. Gesetzte Felder
MUST auf dem Handschirm die Höhe der Leiste nicht vergrößern: die Feldzeile rollt dort
waagerecht, und der Weg zu weiteren Feldern bleibt sichtbar. Weder ein Fokus in der Leiste noch
Tippen darin MUST die Seite rollen. Die Leiste MUST dabei weder waagerecht überlaufen noch das
Dokument waagerecht verbreitern. Auf dem Handschirm MUST die Seite beim Öffnen mindestens zwei
Einträge der Zeitachse vollständig über der Oberkante der Leiste zeigen, auch für eine Rolle
ohne das Recht, den Einsatz abzuschließen.

#### Scenario: Handschirm im Handschuh-Betrieb
- **WHEN** das ETB bei 390 × 844 in `handschuh` geöffnet ist und die Seite ganz oben steht
- **THEN** ist die Erfassungsleiste höchstens 422 px hoch und steht vollständig im Fenster, das Textfeld ist so breit wie die Leiste abzüglich ihrer Polsterung, und das Dokument ist nicht breiter als 390 px

#### Scenario: Drei gesetzte Felder
- **WHEN** auf dem Handschirm im Handschuh-Betrieb ganz oben auf der Seite drei Felder gesetzt werden
- **THEN** rollt die Seite nicht, die Einträge der Zeitachse bleiben an ihrer Stelle, die Leiste wächst um höchstens 2 px, steht vollständig im Fenster, und die Feldzeile rollt waagerecht

#### Scenario: Textfeld ab md
- **WHEN** das ETB bei 820, 1180 und 1440 px Breite geöffnet ist
- **THEN** ist das Textfeld mindestens 60 % so breit wie die Zeile der Schnellerfassung

#### Scenario: Erster Bildschirm auf dem Handy
- **WHEN** das ETB eines Einsatzes mit mindestens zwei Einträgen bei 390 × 844 geöffnet wird, als Admin und als Führungspersonal ohne Abschließen-Recht
- **THEN** liegen mindestens zwei Einträge der Zeitachse vollständig im Fenster und über der Oberkante der Erfassungsleiste
