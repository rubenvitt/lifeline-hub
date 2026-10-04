# lagekarte-kontextmenue Specification

## Purpose

Legt fest, wie man auf der Lagekarte an einer Stelle der Karte per Rechtsklick oder langem Druck
ein Menü mit Handlungen für genau diese Stelle öffnet, wann es öffnet, was es anbietet und wie es
sich bedienen lässt, auch am Tablet mit Handschuh.

## Requirements

### Requirement: Rechtsklick und langer Druck öffnen das Kontextmenü an der Stelle
Ein Rechtsklick auf die Lagekarte und ein langer Druck mit einem Finger (mindestens 500 ms, ohne
nennenswerte Bewegung) SHALL ein Kontextmenü an genau dieser Stelle öffnen. Das Menü MUST dort
erscheinen, wo gedrückt wurde. Der lange Druck MUST die Karte weder kippen noch verschieben, und
das Browser-eigene Kontextmenü MUST NOT erscheinen.

#### Scenario: Langer Druck am Tablet
- **WHEN** der Mensch am Touchschirm einen Finger 600 ms ruhig auf eine freie Stelle der Karte hält
- **THEN** öffnet sich das Kontextmenü an der Druckstelle, und Mitte, Zoom, Neigung und Drehung der Karte sind unverändert

#### Scenario: Rechtsklick am Fükw
- **WHEN** der Mensch mit der Maus rechts auf eine freie Stelle der Karte klickt
- **THEN** öffnet sich das Kontextmenü an der Klickstelle und kein Browser-Kontextmenü

#### Scenario: Ziehen ist kein langer Druck
- **WHEN** der Mensch einen Finger auf die Karte setzt und ihn innerhalb von 500 ms zieht
- **THEN** verschiebt sich die Karte, und es öffnet sich kein Kontextmenü

#### Scenario: Zwei Finger sind kein langer Druck
- **WHEN** der Mensch mit zwei Fingern auf der Karte zoomt
- **THEN** öffnet sich kein Kontextmenü

### Requirement: Loslassen nach dem langen Druck ist kein Tipp
Das Abheben des Fingers, der das Menü per langem Druck geöffnet hat, MUST das Menü offen lassen
und MUST NOT als Tipp auf die Karte wirken: keine Auswahl, kein Inspector, kein Flächen-
Auswahlmenü, kein Verorten.

#### Scenario: Finger hebt über einer Zone ab
- **WHEN** der Mensch in einer Zone lange drückt, das Menü erscheint und er den Finger abhebt
- **THEN** bleibt das Kontextmenü offen, und der Inspector zeigt die Zone nicht

### Requirement: Kein Kontextmenü auf Punktzielen und Trefferzonen
Das Kontextmenü SHALL nur öffnen, wenn an der Stelle kein gezeichnetes Punktziel und keine
Trefferzone liegt (Rangfolge der Klickziele): auf freier Karte und auf einer oder mehreren
Flächen. Auf einem Markerzeichen, seiner Trefferzone, einem Personen- oder Kräfte-Cluster, einem
aufgefächerten Zeichen oder einem Fachebenen-Punkt oder -Bündel MUST es sich nicht öffnen.

#### Scenario: Langer Druck auf einen Marker
- **WHEN** der Mensch innerhalb der Trefferzone eines Markers lange drückt
- **THEN** öffnet sich kein Kontextmenü

#### Scenario: Langer Druck auf einen Kräfte-Cluster
- **WHEN** der Mensch lange auf den Ring eines Kräfte-Clusters drückt
- **THEN** öffnet sich kein Kontextmenü

#### Scenario: Langer Druck in eine Zone
- **WHEN** der Mensch in einer Zone ohne Punktziel und Trefferzone lange drückt
- **THEN** öffnet sich das Kontextmenü

### Requirement: Kein Kontextmenü im exklusiven Modus
In einem exklusiven Kartenmodus (Zeichnen von Abschnitt oder Zone, Messen, Platzieren eines
Objekts, eines Zeichens oder eines Bildes) MUST sich kein Kontextmenü öffnen. Beginnt ein solcher
Modus bei offenem Menü, MUST das Menü schließen.

#### Scenario: Rechtsklick beim Zeichnen
- **WHEN** eine Zone gezeichnet wird und der Mensch rechts auf die Karte klickt oder lange drückt
- **THEN** öffnet sich kein Kontextmenü, und die laufende Zeichnung bleibt unverändert

#### Scenario: Langer Druck beim Messen
- **WHEN** das Messwerkzeug aktiv ist und der Mensch lange auf die Karte drückt
- **THEN** öffnet sich kein Kontextmenü

### Requirement: Einträge des Kontextmenüs
Das Menü SHALL anbieten, in dieser Reihenfolge: „Koordinate kopieren“, „Messen ab hier“ und,
nur mit Schreibrecht im Einsatz, „Hier Zeichen setzen“. Ohne Schreibrecht (auch in der
Snapshot-Ansicht) MUST „Hier Zeichen setzen“ fehlen, nicht gesperrt stehen. Über den Einträgen
MUST das Menü die Koordinate der Stelle im aktiven Koordinatensystem als Kopf zeigen.

#### Scenario: Ohne Schreibrecht
- **WHEN** der Mensch ohne Schreibrecht lange auf die Karte drückt
- **THEN** zeigt das Menü „Koordinate kopieren“ und „Messen ab hier“, aber nicht „Hier Zeichen setzen“

#### Scenario: Mit Schreibrecht
- **WHEN** der Mensch mit Schreibrecht rechts auf die Karte klickt
- **THEN** zeigt das Menü „Koordinate kopieren“, „Messen ab hier“ und „Hier Zeichen setzen“ in dieser Reihenfolge

#### Scenario: Koordinate als Kopf
- **WHEN** als Koordinatensystem UTM eingestellt ist und das Menü offen ist
- **THEN** zeigt das Menü über den Einträgen die Koordinate der Druckstelle in UTM

### Requirement: Koordinate kopieren
Die Wahl von „Koordinate kopieren“ SHALL die Koordinate der Druckstelle als Text im aktiven
Koordinatensystem in die Zwischenablage legen und das quittieren. Gelingt das Kopieren nicht,
MUST eine Fehlermeldung erscheinen, die die Koordinate selbst nennt.

#### Scenario: Kopieren gelingt
- **WHEN** der Mensch „Koordinate kopieren“ wählt
- **THEN** liegt die angezeigte Koordinate in der Zwischenablage, das Menü ist zu, und eine Quittung erscheint

#### Scenario: Zwischenablage verweigert
- **WHEN** der Browser das Schreiben in die Zwischenablage ablehnt und der Mensch „Koordinate kopieren“ wählt
- **THEN** erscheint eine Fehlermeldung mit der Koordinate im Text

### Requirement: Messen ab hier
Die Wahl von „Messen ab hier“ SHALL das Messwerkzeug in der Form Strecke starten, mit der
Druckstelle als erstem gesetzten Punkt. Ein weiterer Tipp MUST die Strecke von der Druckstelle
bis dorthin messen. Für das Messwerkzeug gilt danach alles wie bei einem Start über die
Steuerung, auch das Ende mit einem Esc.

#### Scenario: Strecke ab der Druckstelle
- **WHEN** der Mensch „Messen ab hier“ wählt und danach an eine zweite Stelle tippt
- **THEN** ist das Messwerkzeug aktiv, und es zeigt die Strecke zwischen der Druckstelle und der zweiten Stelle

#### Scenario: Esc beendet
- **WHEN** der Mensch nach „Messen ab hier“ Esc drückt
- **THEN** endet das Messwerkzeug

### Requirement: Hier Zeichen setzen
Die Wahl von „Hier Zeichen setzen“ SHALL nach dem Schließen des Menüs einen Dialog mit der
Zeichenwahl öffnen. „Setzen“ MUST das gewählte Zeichen an der Druckstelle anlegen, ohne weiteren
Tipp auf die Karte, und es in „Zuletzt verwendet“ eintragen. „Abbrechen“ und Esc MUST nichts
anlegen. Ein zweites „Setzen“ während des Speicherns MUST NOT ein zweites Zeichen anlegen;
solange gespeichert wird, MUST sich der Dialog nicht schließen lassen.

#### Scenario: Zeichen an der Druckstelle
- **WHEN** der Mensch „Hier Zeichen setzen“ wählt, im Dialog ein Zeichen wählt und „Setzen“ tippt
- **THEN** schließt der Dialog, und das Zeichen steht an der Druckstelle auf der Karte

#### Scenario: Abbrechen legt nichts an
- **WHEN** der Mensch den Dialog „Hier Zeichen setzen“ mit „Abbrechen“ schließt
- **THEN** ist kein Zeichen angelegt

### Requirement: Bedienung des Kontextmenüs
Jeder Eintrag MUST die Trefferhöhe der eingestellten Dichtestufe haben. Das Menü MUST per
Tastatur bedienbar sein (Pfeiltasten, Enter, Esc). Esc und ein Tipp daneben MUST es ohne Wirkung
schließen, jede Kartenbewegung ebenfalls, und danach MUST der Fokus an der Karte liegen.

#### Scenario: Handschuh-Stufe
- **WHEN** die Dichtestufe „Handschuh“ eingestellt ist und das Kontextmenü offen ist
- **THEN** ist jeder Eintrag mindestens so hoch wie die Steuerhöhe der Stufe

#### Scenario: Tipp daneben
- **WHEN** das Kontextmenü offen ist und der Mensch an eine andere Stelle der Karte tippt
- **THEN** schließt das Menü, ohne dass ein Eintrag ausgeführt wird

#### Scenario: Esc schließt
- **WHEN** das Kontextmenü offen ist und der Mensch Esc drückt
- **THEN** schließt das Menü, nichts wird ausgeführt, und der Fokus liegt auf der Karte

#### Scenario: Kartenbewegung schließt
- **WHEN** das Kontextmenü offen ist und die Karte verschoben oder gezoomt wird
- **THEN** schließt das Menü ohne Wirkung
