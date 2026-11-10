# dokument-entwurf Specification

## Purpose
Legt die Schreibfläche jedes gegliederten Führungsdokuments fest (Lagebericht und
Befehl): ein Muster, damit dasselbe Dokument nicht je Art eine andere Bedienform hat.
Herleitung LLH-1074 (vorher LFH-348, Akkordeon des Lageberichts).

## Requirements

### Requirement: Ein Baustein für alle gegliederten Dokumente

Lagebericht und Befehl SHALL ihren Entwurf über denselben Baustein schreiben: ein Paneel „Entwurf“ mit dem Füllstand („n/m Abschnitte“), einem Kopfblock mit den Feldern der
Seite (Titel, Zeitstand, Verteiler, soweit die Art sie hat), einer Gliederung und allen Abschnitten.
Keine dieser Seiten MUST eine eigene Abschnittsmechanik (Akkordeon, Reiter, Vorschau-Spalte je
Abschnitt) daneben tragen.

#### Scenario: Gleiche Bedienung
- **WHEN** eine Person mit Schreibrecht einen Lagebericht- oder Befehlsentwurf öffnet
- **THEN** stehen Gliederung, Umschalter „Bearbeiten | Lesefassung“ und die Abschnitte in
  derselben Anordnung und Bedienung

### Requirement: Alle Abschnitte offen, mitwachsende Editoren

Im Bearbeiten SHALL jeder Abschnitt offen untereinander stehen, in der Reihenfolge der Vorlage,
mit seinem Namen als Überschrift und seinem Textfeld. Ein leeres Textfeld SHALL einzeilig
beginnen und mit dem Inhalt bis zu einer Obergrenze wachsen; darüber rollt das Feld. Ein
Hilfetext des Abschnitts SHALL als Beschreibung des Textfelds verknüpft sein.

#### Scenario: Leerer Entwurf
- **WHEN** ein Entwurf ohne Text geöffnet wird
- **THEN** ist jedes Textfeld sichtbar und einzeilig, kein Abschnitt ist zugeklappt

### Requirement: Gliederung als Sprungleiste mit Leer-Marke

Die Gliederung SHALL je Abschnitt ein Sprungziel tragen. Ein leerer Abschnitt (kein Text außer
Leerraum) SHALL dort und im Abschnittskopf mit dem Wort „leer“ und einem Zeichen markiert sein,
nie nur durch Farbe. Die Marke SHALL dem Tippen folgen, nicht dem Speichern. Ein Sprung im
Bearbeiten SHALL den Abschnitt an den Anfang des sichtbaren Bereichs rollen und sein Textfeld
fokussieren.

#### Scenario: Leer-Marke folgt dem Tippen
- **WHEN** eine Person in einen leeren Abschnitt den ersten Buchstaben tippt
- **THEN** verliert der Abschnitt in Gliederung und Kopf die Marke „leer“, ohne Speichern

#### Scenario: Sprung
- **WHEN** eine Person in der Gliederung einen Abschnitt wählt
- **THEN** steht sein Kopf oben unter dem Rahmen und der Cursor in seinem Textfeld

### Requirement: Anordnung der Gliederung je Breite

Ab der Breitenstufe `xl` SHALL die Gliederung links neben den Abschnitten stehen und unter dem
Rahmen kleben. Darunter SHALL sie über den Abschnitten in einer Zeile stehen, die in sich
waagerecht rollt, und sie MUST dort nicht kleben (sie verdeckte den Kopf des Abschnitts, zu dem
gesprungen wurde). Die Seite MUST bei 390 px nicht waagerecht scrollen.

#### Scenario: Handy
- **WHEN** der Entwurf bei 390 px Breite steht
- **THEN** rollt die Gliederung in sich, und die Seite scrollt nicht waagerecht

### Requirement: Lesefassung für das ganze Dokument

Der Umschalter „Bearbeiten | Lesefassung“ SHALL für das ganze Dokument gelten. Die Lesefassung
SHALL die aktuellen, auch ungespeicherten Werte so zeigen, wie sie gedruckt werden: je Abschnitt
der Name als Überschrift und der gesetzte Text, ein leerer Abschnitt mit „—“. Die Textfelder
MUST dabei eingehängt bleiben, damit ein Speichern aus der Lesefassung keinen Abschnitt leert.

#### Scenario: Speichern aus der Lesefassung
- **WHEN** eine Person in der Lesefassung „Entwurf speichern“ wählt
- **THEN** schickt der eine PATCH alle Abschnitte mit ihrem Text

### Requirement: Aktion im Abschnittskopf

Der Kopf eines Abschnitts SHALL eine Stelle für eine Aktion der Seite tragen. Der Lagebericht
SHALL dort die Übernahme aus Lagedaten anbieten (Spec `lagevortrag-uebernahme`). Der Baustein
MUST keine Quelle kennen; weitere Füllwege setzen an derselben Stelle an.

#### Scenario: Übernahme im Lagevortrag
- **WHEN** ein Lagevortrag zur Information im Entwurf offen ist
- **THEN** steht der Übernahme-Knopf eines Abschnitts in dessen Kopf

### Requirement: Tippen rendert nur den eigenen Abschnitt

Beim Tippen in einem Abschnitt SHALL nur dessen Feld neu rendern; die übrigen Abschnitte MUST nur
neu rendern, wenn sich ihre eigenen Angaben ändern (etwa die Leer-Marke). Der Nachweis ist ein
Render-Zähler im Komponententest und die Tippmessung im Browser.

#### Scenario: Seite rendert neu
- **WHEN** die Seite wegen eines Kopffelds oder des Speicherstands neu rendert
- **THEN** rendert kein Abschnitt mit

### Requirement: Druck

Gedruckt SHALL werden, was steht: im Bearbeiten je Abschnitt die gesetzte Fassung mit dem Namen
des Abschnitts im selben Titelblock wie der erste Absatz, in der Lesefassung die Lesefassung.
Kein Textfeld, keine Gliederung, kein Umschalter, kein Kopfblock und kein Abschnittskopf MUST
auf Papier stehen; Titel, Zeitstand und Verteiler trägt der Druckkopf der Seite.

#### Scenario: Entwurf drucken
- **WHEN** ein Entwurf mit acht Abschnitten im Bearbeiten gedruckt wird
- **THEN** steht jeder Abschnitt genau einmal gesetzt auf dem Papier, ohne Rohtext und nicht
  abgeschnitten

### Requirement: Rückfrage vor dem Verlassen eines Lagebericht- oder Befehlsentwurfs

Hat ein Lagebericht- oder Befehlsentwurf eine ungespeicherte Fassung und die Person Schreibrecht, SHALL jeder Wechsel auf einen anderen Pfad in der App (Brotkrume, Seitenmenü,
Link, Browser-Zurück) angehalten werden. Beide Seiten SHALL dieselbe Rückfrage „Ungespeicherte
Änderungen“ mit „Verwerfen“, „Bleiben“ und „Speichern und weiter“ zeigen. „Speichern und weiter“
MUST erst nach gelungenem Speichern wechseln. Ohne ungespeicherte Fassung MUST NOT nachgefragt
werden.

#### Scenario: Lagebericht über die Brotkrume verlassen
- **WHEN** eine Person im Lagebericht-Entwurf den Titel ändert und vor dem Speichern
  „Lageberichte“ in der Brotkrume wählt
- **THEN** erscheint die Rückfrage „Ungespeicherte Änderungen“ wie im Befehl, und nach „Bleiben“
  steht die Eingabe unverändert im Feld

#### Scenario: Speichern und weiter ohne Titel
- **WHEN** der Titel des Entwurfs leer ist und in der Rückfrage „Speichern und weiter“ gewählt wird
- **THEN** steht der Feldfehler am Titel, und die Seite bleibt beim Entwurf

#### Scenario: Speichern und weiter scheitert
- **WHEN** in der Rückfrage „Speichern und weiter“ gewählt wird und der Server das Speichern
  ablehnt
- **THEN** steht der Grund im Dialog, und die Seite bleibt beim Entwurf

#### Scenario: Autosave während der Rückfrage
- **WHEN** die Rückfrage offen steht und der Autosave die Fassung sichert
- **THEN** folgt der angehaltene Wechsel ohne weiteren Klick

#### Scenario: Ohne offene Fassung
- **WHEN** ein unveränderter Entwurf oder ein freigegebenes Dokument verlassen wird, oder sich nur
  Suchparameter oder Anker ändern
- **THEN** erscheint keine Rückfrage

### Requirement: Gebündelte Aktionen eines Abschnitts

Im Bearbeiten SHALL der Kopf jedes Abschnitts ein ⋮-Menü tragen, benannt mit dem Namen des
Abschnitts, mit „Text kopieren“, „In der Lesefassung zeigen“ und rot hinter einem Trenner
„Abschnitt leeren“. Auf Papier MUST es nicht stehen.

#### Scenario: Menü eines Abschnitts
- **WHEN** eine Person im Lagebericht-Entwurf das ⋮ „Aktionen zu Abschnitt Auftrag“ öffnet
- **THEN** stehen darin „Text kopieren“, „In der Lesefassung zeigen“, ein Trenner und rot
  „Abschnitt leeren“, und der Fokus liegt im Menü

### Requirement: Text eines Abschnitts kopieren

„Text kopieren“ SHALL den Text des Abschnitts, wie er im Feld steht, auch ungespeichert, in die
Zwischenablage legen und Erfolg oder Fehlschlag melden. Bei leerem Abschnitt oder ohne
Zwischenablage MUST der Eintrag gesperrt stehen.

#### Scenario: Kopieren
- **WHEN** im Abschnitt „Lage“ ungespeichert „Lage ruhig“ steht und jemand „Text kopieren“ wählt
- **THEN** liegt „Lage ruhig“ in der Zwischenablage, und eine Meldung nennt den Abschnitt

#### Scenario: Leerer Abschnitt
- **WHEN** jemand das Menü eines leeren Abschnitts öffnet
- **THEN** stehen „Text kopieren“ und „Abschnitt leeren“ gesperrt darin, „In der Lesefassung
  zeigen“ bleibt wählbar

### Requirement: Abschnitt in der Lesefassung zeigen

„In der Lesefassung zeigen“ SHALL das ganze Dokument auf die Lesefassung schalten und den
gewählten Abschnitt an den Anfang des sichtbaren Bereichs rollen. Der Fokus MUST danach auf diesem
Abschnitt der Lesefassung stehen, nicht im Leeren.

#### Scenario: Aus dem Bearbeiten
- **WHEN** jemand im Bearbeiten beim Abschnitt „Durchführung“ „In der Lesefassung zeigen“ wählt
- **THEN** ist „Lesefassung“ gewählt, „Durchführung“ steht oben, und der Fokus liegt dort

### Requirement: Abschnitt nach Rückfrage leeren

„Abschnitt leeren“ SHALL erst nach einer Rückfrage im Dialog wirken, deren Knopf „Abschnitt
leeren“ heißt. Bestätigt, MUST der Abschnitt so leer werden wie nach Löschen von Hand:
Leer-Marke und Füllstand folgen, und die Änderung zählt als ungespeichert. An einem leeren
Abschnitt MUST der Eintrag gesperrt stehen.

#### Scenario: Leeren bestätigt
- **WHEN** jemand beim gefüllten Abschnitt „Auftrag“ „Abschnitt leeren“ wählt und im Dialog „Abschnitt leeren“ bestätigt
- **THEN** ist das Feld leer, „Auftrag“ trägt in Gliederung und Kopf „leer“, und das Verlassen der
  Seite fragt nach ungespeicherten Änderungen

#### Scenario: Leeren abgebrochen
- **WHEN** jemand die Rückfrage mit „Abbrechen“ schließt
- **THEN** bleibt der Text unverändert

#### Scenario: Stand der Übernahme
- **WHEN** im Lagevortrag ein übernommener Abschnitt geleert wird
- **THEN** verliert er seinen Stand der Übernahme wie beim Löschen von Hand

### Requirement: Kontextmenü an Gliederung und Abschnittskopf

Ein Rechtsklick, ein langer Druck oder die Kontextmenü-Taste/Umschalt+F10 auf einem
Gliederungseintrag SHALL ein Menü öffnen mit „Zum Abschnitt springen“ zuoberst, danach den
Einträgen des Abschnitts. Auf dem Abschnittskopf SHALL es die Einträge seines ⋮ zeigen. Im
Textfeld MUST das Browsermenü bleiben.

#### Scenario: Rechtsklick in der Gliederung
- **WHEN** jemand mit der rechten Maustaste auf „Auftrag“ in der Gliederung klickt
- **THEN** öffnet am Zeiger ein Menü mit „Zum Abschnitt springen“, „Text kopieren“, „In der
  Lesefassung zeigen“, einem Trenner und rot „Abschnitt leeren“

#### Scenario: Rechtsklick im Textfeld
- **WHEN** jemand mit der rechten Maustaste in das Textfeld eines Abschnitts klickt
- **THEN** erscheint das Browsermenü mit „Einfügen“ und kein eigenes Menü

#### Scenario: Gliederung in der Lesefassung
- **WHEN** die Lesefassung gewählt ist und jemand das Kontextmenü eines Gliederungseintrags öffnet
- **THEN** fehlt „In der Lesefassung zeigen“, und „Zum Abschnitt springen“ rollt zum Abschnitt der
  Lesefassung
