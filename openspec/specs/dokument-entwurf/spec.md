# dokument-entwurf Specification

## Purpose
Legt die Schreibfläche jedes gegliederten Führungsdokuments fest (Lagebericht, Befehl,
Pressemitteilung): ein Muster, damit dasselbe Dokument nicht je Art eine andere Bedienform hat.
Herleitung LLH-1074 (vorher LFH-348, Akkordeon des Lageberichts).

## Requirements

### Requirement: Ein Baustein für alle gegliederten Dokumente

Lagebericht, Befehl und Pressemitteilung SHALL ihren Entwurf über denselben Baustein schreiben:
ein Paneel „Entwurf“ mit dem Füllstand („n/m Abschnitte“), einem Kopfblock mit den Feldern der
Seite (Titel, Zeitstand, Verteiler, soweit die Art sie hat), einer Gliederung und allen Abschnitten.
Keine dieser Seiten MUST eine eigene Abschnittsmechanik (Akkordeon, Reiter, Vorschau-Spalte je
Abschnitt) daneben tragen.

#### Scenario: Gleiche Bedienung
- **WHEN** eine Person mit Schreibrecht einen Lagebericht-, Befehls- oder
  Pressemitteilungsentwurf öffnet
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
