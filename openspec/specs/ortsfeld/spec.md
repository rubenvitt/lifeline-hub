# ortsfeld Specification

## Purpose
Erfasst eine Ortsangabe als Adresse und Koordinate zugleich: Adresssuche über den Geocoder der
Organisation, Wahl eines Treffers, Zustände der Suche und ein Kartenausschnitt, der zeigt, wo der
Ort liegt. Regelt die Such-Einstiege, die dafür kein Recht auf die Lagekarte brauchen.

## Requirements

### Requirement: Adresssuche auf Enter oder Knopf
Das Ortsfeld SHALL eine Adresse erst suchen, wenn die Person Enter drückt oder den Knopf „Ort
suchen“ wählt; beim Tippen MUST keine Anfrage an den Server gehen. Gesucht wird nur, wenn der
getrimmte Text mindestens drei und höchstens 200 Zeichen hat. Die Treffer, höchstens fünf, MUST
unter dem Feld stehen, jeder mit der Kurzadresse, wenn der Server eine liefert, sonst mit der
Beschriftung des Geocoders. Enter im Ortsfeld MUST suchen und nicht das umgebende Formular
absenden.

#### Scenario: Tippen fragt nicht
- **WHEN** die Person „Hauptstraße 12“ in das Ortsfeld tippt, ohne Enter oder den Knopf
- **THEN** geht keine Anfrage an die Ortssuche, und es steht keine Trefferliste da

#### Scenario: Enter sucht
- **WHEN** die Person „Hauptstraße 12, Musterstadt“ tippt und Enter drückt
- **THEN** stehen nach der Antwort die Treffer unter dem Feld, und das umgebende Formular ist nicht abgesendet

#### Scenario: Zu kurz
- **WHEN** die Person „Ha“ tippt und Enter drückt
- **THEN** geht keine Anfrage an die Ortssuche

#### Scenario: Weitertippen verwirft die Treffer
- **WHEN** Treffer zu „Hauptstraße“ dastehen und die Person den Text ändert
- **THEN** verschwindet die Trefferliste, bis sie erneut sucht

### Requirement: Treffer setzt Adresse und Koordinate
Wählt die Person einen Treffer, SHALL das Ortsfeld als Text die Kurzadresse des Treffers
übernehmen (ohne Kurzadresse die Beschriftung des Geocoders) und die Koordinate des Treffers
mitführen. Ändert die Person den Text danach, MUST das Feld die Koordinate des Treffers wieder
fallen lassen: der Wert ist dann reiner Text. Freitext ohne Treffer SHALL erlaubt bleiben.

#### Scenario: Treffer wählen
- **WHEN** die Person nach „Bahnhofstraße 1“ sucht und den Treffer „Bahnhofstraße 1, 12345 Musterstadt“ wählt
- **THEN** steht dieser Text im Feld, und der Wert trägt die Koordinate des Treffers

#### Scenario: Text nach der Wahl geändert
- **WHEN** die Person einen Treffer gewählt hat und danach „ (Hinterhof)“ an den Text anhängt
- **THEN** trägt der Wert keine Koordinate mehr, nur den Text

#### Scenario: Freitext ohne Suche
- **WHEN** die Person „BAB 7 km 123“ tippt, ohne zu suchen
- **THEN** ist der Wert dieser Text ohne Koordinate

### Requirement: Zustände der Ortssuche am Feld
Das Ortsfeld SHALL während der Suche einen Ladezustand zeigen und danach genau eine Aussage am
Feld: die Treffer, „Keine Adresse zu „<Begriff>“ gefunden“, „Adresssuche ausgelastet“ oder
„Adresssuche nicht erreichbar“; die beiden letzten mit dem Knopf „Erneut suchen“. Ohne Netz MUST
der Knopf „Ort suchen“ gesperrt sein und das Feld „Adresssuche ohne Netz nicht verfügbar“ sagen;
Freitext bleibt möglich. Eine leere Trefferliste ohne Aussage MUST NOT vorkommen.

#### Scenario: Ausgelastet
- **WHEN** der Server auf eine Suche mit dem Zustand „ausgelastet“ antwortet
- **THEN** sagt das Feld „Adresssuche ausgelastet“ und bietet „Erneut suchen“ an

#### Scenario: Keine Treffer
- **WHEN** der Server mit Zustand „ok“ und ohne Treffer antwortet
- **THEN** sagt das Feld „Keine Adresse zu „Hauptstraße 999“ gefunden“

#### Scenario: Ohne Netz
- **WHEN** das Gerät offline ist und die Person „Hauptstraße 12“ tippt
- **THEN** ist „Ort suchen“ gesperrt, das Feld sagt „Adresssuche ohne Netz nicht verfügbar“, und der Text lässt sich weiter eingeben

### Requirement: Kartenausschnitt zeigt den Ort
Zu einem Ort mit Koordinate SHALL ein kleiner Kartenausschnitt ohne Bedienung den Punkt mit einer
Nadel zeigen, auf derselben Kartengrundlage wie die Lagekarte (online, Offline-Karten oder ohne
Kacheln). Ohne Koordinate MUST statt der Karte „Nicht verortet“ stehen.

#### Scenario: Verorteter Ort
- **WHEN** der Ort die Koordinate 51.16040, 10.45140 trägt
- **THEN** zeigt der Ausschnitt eine Karte um diesen Punkt mit einer Nadel „Einsatzort“

#### Scenario: Ohne Koordinate
- **WHEN** der Ort nur eine Adresse trägt
- **THEN** zeigt der Ausschnitt „Nicht verortet“ und keine Karte

### Requirement: Ortssuche im Einsatz ohne Lagekarten-Recht
Der Server SHALL eine Ortssuche im Einsatz anbieten, die das Recht verlangt, die Einsatzdaten zu
ändern (Einsatzleitung, Führungspersonal, Admin der Einsatz-Organisation, nur am laufenden
Einsatz), und kein Recht auf das Modul Lagekarte. Sie MUST die Umgebung des Einsatzorts
bevorzugen, wenn er verortet ist, und dieselben Grenzen einhalten wie die Adresssuche der
Lagekarte.

#### Scenario: Führungspersonal ohne Lagekarte
- **WHEN** eine Person mit Schreibrecht im Einsatz, aber ohne Zugriff auf das Modul Lagekarte die Ortssuche im Einsatz aufruft
- **THEN** antwortet der Server mit 200 und den Treffern

#### Scenario: Beobachter
- **WHEN** eine Person mit der Rolle Beobachter die Ortssuche im Einsatz aufruft
- **THEN** antwortet der Server mit 403 und fragt den Geocoder nicht

#### Scenario: Fremde Organisation
- **WHEN** eine Person einer anderen Organisation die Ortssuche des Einsatzes aufruft
- **THEN** antwortet der Server mit 403 und fragt den Geocoder nicht

### Requirement: Ortssuche in der Organisation
Der Server SHALL eine Ortssuche ohne Einsatz anbieten, für Personen, die Einsätze anlegen dürfen
(Admin, Führungskraft). Sie MUST den Geocoder der eigenen Organisation fragen, ohne bevorzugte
Umgebung, und dieselben Grenzen einhalten wie die Adresssuche der Lagekarte. Andere Rollen MUST
403 erhalten, ohne dass der Geocoder gefragt wird.

#### Scenario: Führungskraft
- **WHEN** eine Führungskraft die Ortssuche der Organisation mit „Hauptstraße 12“ aufruft
- **THEN** fragt der Server den Geocoder ihrer Organisation und antwortet mit 200 und den Treffern

#### Scenario: Helfer
- **WHEN** eine Person, die keine Einsätze anlegen darf, die Ortssuche der Organisation aufruft
- **THEN** antwortet der Server mit 403 und fragt den Geocoder nicht

#### Scenario: Geocoder der eigenen Organisation
- **WHEN** zwei Organisationen verschiedene Geocoder eingestellt haben und eine Führungskraft der ersten sucht
- **THEN** geht die Anfrage an den Geocoder der ersten Organisation

### Requirement: Kurzadresse der Treffer
Jeder Treffer einer Ortssuche SHALL neben der Beschriftung des Geocoders eine Kurzadresse tragen,
wenn der Geocoder Straße oder Ort liefert, in der Form „Straße Hausnummer, PLZ Ort“; fehlende Teile
entfallen samt Trennzeichen. Liefert der Geocoder keine Adressteile, MUST die Kurzadresse fehlen.

#### Scenario: Volle Adresse
- **WHEN** der Geocoder Straße „Hauptstraße“, Hausnummer „12“, PLZ „12345“ und Ort „Musterstadt“ liefert
- **THEN** trägt der Treffer die Kurzadresse „Hauptstraße 12, 12345 Musterstadt“

#### Scenario: Nur Ort
- **WHEN** der Geocoder nur den Ort „Musterstadt“ liefert
- **THEN** trägt der Treffer die Kurzadresse „Musterstadt“

#### Scenario: Ohne Adressteile
- **WHEN** der Geocoder keine Adressteile liefert
- **THEN** trägt der Treffer keine Kurzadresse, nur die Beschriftung

### Requirement: Einsatzort beim Anlegen
Der Dialog „Einsatz anlegen“ SHALL ein optionales Feld „Einsatzort“ als Ortsfeld tragen, das die
Ortssuche der Organisation nutzt. Nach der Wahl eines Treffers SHALL darunter ein kleiner
Kartenausschnitt stehen. Das Anlegen MUST Adresse und, falls ein Treffer gewählt ist, die
Koordinate mitsenden; ein leeres Feld sendet keinen Einsatzort.

#### Scenario: Anlegen mit Treffer
- **WHEN** eine Führungskraft im Dialog „Einsatz anlegen“ nach „Bahnhofstraße 1“ sucht, einen Treffer wählt und anlegt
- **THEN** trägt der neue Einsatz Adresse und Koordinate des Treffers

#### Scenario: Anlegen mit Freitext
- **WHEN** die Führungskraft „Waldweg hinter Sportplatz“ einträgt, ohne zu suchen, und anlegt
- **THEN** trägt der neue Einsatz diese Adresse und keine Koordinate

#### Scenario: Anlegen ohne Einsatzort
- **WHEN** die Führungskraft das Feld leer lässt und anlegt
- **THEN** trägt der neue Einsatz weder Adresse noch Koordinate

### Requirement: Koordinate des Einsatzorts wird geprüft
Anlegen und Ändern eines Einsatzes SHALL eine Koordinate des Einsatzorts nur annehmen, wenn die
Breite zwischen −90 und 90 und die Länge zwischen −180 und 180 liegt; sonst MUST der Server mit
400 antworten. Breite und Länge MUST gemeinsam gesetzt oder gemeinsam geleert werden; eine
Anfrage mit nur einer von beiden oder mit einem Wert und einem `null` MUST mit 422 abgelehnt
werden.

#### Scenario: Breite außerhalb
- **WHEN** eine Anfrage `einsatzort_lat: 91` und `einsatzort_lon: 10` sendet
- **THEN** antwortet der Server mit 400 und ändert nichts

#### Scenario: Nur die Länge
- **WHEN** eine Anfrage `einsatzort_lon: 10` ohne `einsatzort_lat` sendet
- **THEN** antwortet der Server mit 422 und ändert nichts

#### Scenario: Paar leeren
- **WHEN** eine Anfrage `einsatzort_lat: null` und `einsatzort_lon: null` sendet
- **THEN** ist der Einsatzort danach nicht verortet
