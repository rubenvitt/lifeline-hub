# lagekarte-ortssuche Specification

## Purpose
Lässt die Lagekarte einen Ort ansteuern, der nicht als Objekt verortet ist: über eine eingegebene
Koordinate oder Adresse, markiert mit einer vorläufigen Suchnadel, und regelt die Grenzen der
Adressauflösung über den Geocoder (Rate-Limit, Datenschutz, Ausfall).

## Requirements

### Requirement: Koordinate im Suchfeld der Kartenleiste
Das Suchfeld der Kartenleiste SHALL eine eingegebene Koordinate beim Tippen erkennen, ohne Abfrage
an den Server, und sie als genau einen Treffer in einer Gruppe „Koordinate“ über allen
Objektgruppen anbieten. Erkannt MUST jede Form werden, die der Koordinatensprung der Sprungpalette
erkennt; beschriftet wird im eingestellten Koordinatenformat. Was keine Koordinate ist, MUST keine
Gruppe „Koordinate“ erzeugen.

#### Scenario: Dezimalgrad
- **WHEN** die Person „51.16040, 10.45140“ in das Suchfeld tippt
- **THEN** steht über den Objektgruppen die Gruppe „Koordinate“ mit einem Treffer für diesen Punkt

#### Scenario: MGRS bei eingestelltem Dezimalformat
- **WHEN** das Koordinatenformat WGS84 eingestellt ist und die Person eine gültige MGRS-Angabe tippt
- **THEN** steht der Treffer in der Gruppe „Koordinate“, beschriftet in WGS84

#### Scenario: Hausnummer ist keine Koordinate
- **WHEN** die Person „12 34“ tippt
- **THEN** erscheint keine Gruppe „Koordinate“

#### Scenario: Ohne Netz
- **WHEN** der Server nicht erreichbar ist und die Person eine Koordinate tippt
- **THEN** steht der Koordinatentreffer trotzdem da und lässt sich anspringen

### Requirement: Adresssuche erst auf Enter
Das Suchfeld SHALL eine Adresse erst suchen, wenn die Person Enter drückt; beim Tippen MUST keine
Anfrage an den Geocoder gehen. Enter löst die Adresssuche nur aus, wenn die Eingabe mindestens
drei Zeichen hat und keine Koordinate ist. Die Treffer, höchstens fünf, MUST in einer Gruppe
„Adresse“ unter einer erkannten Koordinate und über den Objektgruppen stehen, beschriftet mit
dem Namen, den der Geocoder liefert.

#### Scenario: Tippen fragt nicht
- **WHEN** die Person „Hauptstraße 12“ tippt, ohne Enter zu drücken
- **THEN** geht keine Anfrage an die Adresssuche, und eine Gruppe „Adresse“ steht nicht da

#### Scenario: Enter sucht
- **WHEN** die Person „Hauptstraße 12, Musterstadt“ tippt und Enter drückt
- **THEN** steht nach der Antwort die Gruppe „Adresse“ mit den Treffern des Geocoders da

#### Scenario: Zu kurz
- **WHEN** die Person „Ha“ tippt und Enter drückt
- **THEN** geht keine Anfrage an die Adresssuche

#### Scenario: Weitertippen verwirft die Treffer
- **WHEN** Adresstreffer zu „Hauptstraße“ dastehen und die Person den Text ändert
- **THEN** verschwindet die Gruppe „Adresse“, bis sie erneut Enter drückt

### Requirement: Adresssuche bevorzugt die Einsatzumgebung
Ist der Einsatzort verortet, SHALL die Adresssuche Treffer in seiner Umgebung vor gleichnamigen
Treffern anderswo reihen. Treffer außerhalb der Umgebung MUST sie nicht ausschließen.

#### Scenario: Gleichnamige Straße
- **WHEN** der Einsatzort in Musterstadt liegt und die Person „Bahnhofstraße 1“ sucht
- **THEN** steht der Treffer in Musterstadt vor gleichnamigen Treffern anderer Orte

#### Scenario: Ohne Einsatzort
- **WHEN** der Einsatzort nicht verortet ist
- **THEN** liefert die Adresssuche die Treffer in der Reihenfolge des Geocoders

### Requirement: Zustände der Adresssuche
Die Gruppe „Adresse“ SHALL während der Suche einen Ladezustand zeigen und danach genau eine
Aussage: Treffer, „Keine Adresse zu „<Begriff>“ gefunden“, „Adresssuche gerade ausgelastet“ mit
dem Hinweis, gleich erneut Enter zu drücken, oder „Adresssuche nicht erreichbar“. Kein dieser
Zustände MUST die Objektsuche oder den Koordinatentreffer verdecken.

#### Scenario: Geocoder nicht erreichbar
- **WHEN** der Geocoder nicht antwortet und die Person Enter drückt
- **THEN** sagt die Gruppe „Adresse“ „Adresssuche nicht erreichbar“, und passende Kartenobjekte stehen weiter darunter

#### Scenario: Ausgelastet
- **WHEN** das Rate-Limit des Geocoders erschöpft ist
- **THEN** sagt die Gruppe „Adresse“, dass die Suche ausgelastet ist und gleich erneut versucht werden kann

#### Scenario: Nichts gefunden
- **WHEN** der Geocoder zu „xyzzy“ nichts findet
- **THEN** sagt die Gruppe „Adresse“ „Keine Adresse zu „xyzzy“ gefunden“

### Requirement: Treffer fliegt an und setzt die Suchnadel
Ein Klick auf einen Koordinaten- oder Adresstreffer SHALL die Karte zu dem Punkt fliegen lassen und
dort eine Suchnadel setzen, beschriftet mit der Adresse bzw. der Koordinate im eingestellten
Format. Liefert eine Adresssuche genau einen Treffer, MUST die Karte ohne weiteren Klick
hinfliegen. Jeder Treffer MUST ein Bedienziel mit dem Trefflächenboden der aktiven Dichtestufe sein.

#### Scenario: Adresstreffer anklicken
- **WHEN** die Person den Adresstreffer „Hauptstraße 12, Musterstadt“ anklickt
- **THEN** fliegt die Karte hin, und eine Suchnadel mit dieser Beschriftung steht am Punkt

#### Scenario: Genau ein Treffer
- **WHEN** eine Adresssuche genau einen Treffer liefert
- **THEN** fliegt die Karte ohne weiteren Klick hin und setzt die Suchnadel

### Requirement: Die Suchnadel ist vorläufig
Es SHALL höchstens eine Suchnadel geben; eine neue ersetzt die alte. Solange sie steht, MUST die
Karte ihre Beschriftung und eine Bedienung „Suchnadel entfernen“ zeigen. Die Suchnadel MUST nicht
gespeichert werden: nicht am Einsatz, nicht in Kartenansichten, nicht in Lage-Snapshots, und sie
ist nach dem Neuladen der Seite fort.

#### Scenario: Neue Suche ersetzt
- **WHEN** eine Suchnadel steht und die Person einen anderen Treffer anklickt
- **THEN** steht nur noch die neue Suchnadel

#### Scenario: Entfernen
- **WHEN** die Person „Suchnadel entfernen“ bedient
- **THEN** ist die Suchnadel fort, und die Kartenansicht bleibt, wo sie ist

#### Scenario: Nicht gespeichert
- **WHEN** eine Suchnadel steht und die Person die Seite neu lädt oder eine Ansicht speichert
- **THEN** steht nach dem Neuladen keine Suchnadel, und die gespeicherte Ansicht enthält keine

### Requirement: Die Suchnadel ist kein Klickziel
Die Suchnadel SHALL keine eigene Klickebene sein: ein Tipp auf ihre Stelle MUST an das Ziel gehen,
das dort ohne Suchnadel getroffen würde.

#### Scenario: Marker unter der Nadel
- **WHEN** eine Suchnadel auf dem Marker einer Einheit steht und die Person dorthin tippt
- **THEN** wird die Einheit ausgewählt

### Requirement: Lagekarte nimmt Ort und Zentrum per Link an
Die Lagekarte SHALL `?zentrum=<lat>,<lon>` anfliegen und dort die Suchnadel mit der Koordinate
setzen. Sie SHALL `?ort=<Text>` in das Suchfeld übernehmen, die Adresssuche auslösen und die Treffer
in der Kartenleiste zeigen, am Handschirm auch bei zugeklappter Leiste. Beide Parameter MUST nach
der Übernahme aus der Adresse verschwinden.

#### Scenario: Koordinatensprung setzt die Nadel
- **WHEN** die Person in der Sprungpalette „Auf Lagekarte zeigen“ für eine Koordinate wählt
- **THEN** fliegt die Karte hin, und die Suchnadel steht mit der Koordinate beschriftet

#### Scenario: Adresse per Link am Handschirm
- **WHEN** die Lagekarte bei 390 px Breite mit `?ort=Hauptstraße 12` öffnet
- **THEN** steht der Text im Suchfeld, die Leiste ist offen und zeigt die Gruppe „Adresse“

### Requirement: Adresssuche über den Server mit Grenzen
Die Adressauflösung SHALL über den Server laufen, an den Geocoder der Organisation (ohne Einstellung
der öffentliche Nominatim) und nur mit dem Recht auf das Modul Lagekarte. Der Server MUST für alle
Geocoder-Anfragen zusammen höchstens eine je Sekunde stellen, jede nach spätestens 1,5 Sekunden
aufgeben und Geocoder-Fehler als Zustand der Antwort melden, nie als Fehlerstatus. Ein Suchtext
unter drei oder über 200 Zeichen MUST mit 400 abgelehnt werden.

#### Scenario: Ohne Lagekarte-Recht
- **WHEN** eine Person ohne Zugriff auf das Modul Lagekarte die Adresssuche aufruft
- **THEN** antwortet der Server mit 403 und fragt den Geocoder nicht

#### Scenario: Geocoder fällt aus
- **WHEN** der Geocoder nicht antwortet
- **THEN** antwortet der Server mit 200 und dem Zustand „nicht erreichbar“ ohne Treffer

#### Scenario: Leerer Suchtext
- **WHEN** die Adresssuche mit einem Suchtext aus zwei Zeichen aufgerufen wird
- **THEN** antwortet der Server mit 400

### Requirement: Datenschutz der Ortssuche
Eine Koordinatensuche MUST den Punkt nicht an den Server oder den Geocoder senden. Eine Adresssuche
SHALL nur den Suchtext und, wenn der Einsatzort verortet ist, einen groben Ausschnitt um ihn an den
Geocoder senden, keine Einsatzdaten darüber hinaus.

#### Scenario: Koordinate bleibt lokal
- **WHEN** die Person eine Koordinate sucht und anspringt
- **THEN** geht dafür keine Anfrage an den Server
