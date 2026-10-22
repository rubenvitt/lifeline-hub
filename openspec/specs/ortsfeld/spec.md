# ortsfeld Specification

## Purpose
Erfasst eine Ortsangabe als Adresse und Koordinate zugleich: Adresssuche über den Geocoder der
Organisation, Wahl eines Treffers, Zustände der Suche, eine getippte Koordinate, eine
Kartenvorschau mit ziehbarer Nadel und die Wahl auf einer großen Karte, damit man sieht und
berichtigt, wo der Ort liegt. Personenbezogene Adressen gehen nie an den Geocoder. Regelt die
Such-Einstiege, die dafür kein Recht auf die Lagekarte brauchen.

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
fallen lassen: der Wert ist dann reiner Text. Eine auf der Karte gesetzte Koordinate (Nadel
gezogen, auf der Karte gewählt, Ortsname übernommen) MUST eine Textänderung überstehen. Freitext
ohne Treffer SHALL erlaubt bleiben.

#### Scenario: Treffer wählen
- **WHEN** die Person nach „Bahnhofstraße 1“ sucht und den Treffer „Bahnhofstraße 1, 12345 Musterstadt“ wählt
- **THEN** steht dieser Text im Feld, und der Wert trägt die Koordinate des Treffers

#### Scenario: Text nach der Wahl geändert
- **WHEN** die Person einen Treffer gewählt hat und danach „ (Hinterhof)“ an den Text anhängt
- **THEN** trägt der Wert keine Koordinate mehr, nur den Text

#### Scenario: Freitext ohne Suche
- **WHEN** die Person „BAB 7 km 123“ tippt, ohne zu suchen
- **THEN** ist der Wert dieser Text ohne Koordinate

#### Scenario: Text nach Kartenwahl geändert
- **WHEN** die Person die Nadel gezogen hat und danach „ links“ an den Text anhängt
- **THEN** trägt der Wert weiter die Koordinate der Nadel

### Requirement: Koordinate im Feld
Tippt die Person eine Koordinate in das Ortsfeld, SHALL das Feld sie beim Tippen erkennen, in jeder
Form, die der Koordinatensprung der Sprungpalette erkennt, und als Koordinate des Werts führen,
ohne Anfrage an den Server und auch ohne Netz. Der Text bleibt, wie getippt. „Ort suchen“ MUST
für eine Koordinate gesperrt bleiben. Was keine Koordinate ist („12 34“), MUST reiner Text bleiben.

#### Scenario: MGRS getippt
- **WHEN** die Person eine gültige MGRS-Angabe in das Ortsfeld tippt
- **THEN** trägt der Wert deren Koordinate, und es ging keine Anfrage an die Ortssuche

#### Scenario: Hausnummer
- **WHEN** die Person „12 34“ tippt
- **THEN** trägt der Wert keine Koordinate

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
Kacheln). Ohne Koordinate MUST statt der Karte „Nicht verortet“ stehen. Kann das Gerät die Karte
nicht zeichnen (kein WebGL2), MUST an Stelle der Karte „Karte auf diesem Gerät nicht darstellbar“
stehen, ohne die Technik zu nennen, und die Seite MUST NOT in die Fehlerseite der App fallen; ein
anderer Fehler beim Aufbau der Karte MUST weiter als Fehler gelten.
Einziges mögliches Bedienziel des Ausschnitts ist die ziehbare Nadel der Kartenvorschau am
Ortsfeld; die Karte selbst lässt sich weder verschieben noch zoomen.

#### Scenario: Verorteter Ort
- **WHEN** der Ort die Koordinate 51.16040, 10.45140 trägt
- **THEN** zeigt der Ausschnitt eine Karte um diesen Punkt mit einer Nadel „Einsatzort“

#### Scenario: Ohne Koordinate
- **WHEN** der Ort nur eine Adresse trägt
- **THEN** zeigt der Ausschnitt „Nicht verortet“ und keine Karte

#### Scenario: Gerät ohne Kartengrafik
- **WHEN** der Einsatzort eine Koordinate trägt und der Browser kein WebGL2 hat
- **THEN** zeigen die Einsatzdaten und der Anlegedialog an Stelle des Ausschnitts „Karte auf diesem Gerät nicht darstellbar“
- **AND** es erscheint keine Fehlerseite der App, und das Paneel bzw. der Dialog bleibt bedienbar

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

### Requirement: Kartenvorschau am Ortsfeld
Ein Ortsfeld mit Kartenvorschau SHALL unter dem Feld zu einer Koordinate einen Kartenausschnitt
mit Nadel zeigen und ohne Koordinate „Nicht verortet“, in beiden Fällen mit dem Knopf „Auf Karte
wählen“. Im Einsatz SHALL unter dem Ausschnitt die Ort-Zeile stehen: Ortsname und Peilung zum
nächsten verorteten Objekt, nie zum Objekt selbst. Die Vorschau MUST bei 390 px Breite in der
Seite bleiben.

#### Scenario: Treffer im Einsatz
- **WHEN** die Person in den Einsatzdaten einen Treffer der Ortssuche wählt
- **THEN** stehen unter dem Feld der Ausschnitt mit der Nadel und die Ort-Zeile „<Ortsname> · <Distanz> <Richtung> von <Objekt>“

#### Scenario: Ohne Koordinate
- **WHEN** der Wert keine Koordinate trägt
- **THEN** steht unter dem Feld „Nicht verortet“ mit „Auf Karte wählen“ und keine Karte

#### Scenario: Ohne Einsatz
- **WHEN** im Dialog „Einsatz anlegen“ ein Treffer gewählt ist
- **THEN** steht der Ausschnitt mit Nadel da, ohne Ort-Zeile und ohne Anfrage an die Ort-Vorschau

### Requirement: Nadel verschieben
Die Nadel der Kartenvorschau SHALL sich mit Maus, Finger und Pfeiltasten verschieben lassen (mit
Umschalt in großen Schritten). Das Verschieben MUST die Koordinate des Werts ändern und den Text
stehen lassen. Die Nadel MUST ein Bedienziel mit der Steuerhöhe der aktiven Dichtestufe im
Quadrat sein.

#### Scenario: Gezogen
- **WHEN** die Person die Nadel eines gewählten Treffers 60 px nach Osten zieht
- **THEN** trägt der Wert eine Koordinate weiter östlich, und der Text ist unverändert

#### Scenario: Pfeiltaste
- **WHEN** die Nadel den Fokus hat und die Person die Pfeiltaste rechts drückt
- **THEN** rückt die Nadel nach Osten, und der Wert trägt den neuen Punkt

### Requirement: Ortsname als Vorschlag
Stammt die Koordinate nicht aus einem Treffer (getippt oder auf der Karte gesetzt) und weicht der
Ortsname der Ort-Zeile vom Text ab, SHALL das Feld „Als Adresse übernehmen“ anbieten; das setzt
den Ortsnamen als Text und behält die Koordinate. Den getippten Text MUST das Feld nie von sich
aus überschreiben.

#### Scenario: Nach dem Ziehen
- **WHEN** die Person die Nadel gezogen hat und der Ortsname der neuen Stelle „Marktplatz 3, 12345 Musterstadt“ lautet
- **THEN** bleibt der Text, und „Als Adresse übernehmen“ setzt „Marktplatz 3, 12345 Musterstadt“

#### Scenario: Treffer gewählt
- **WHEN** die Koordinate aus einem gewählten Treffer stammt
- **THEN** steht kein „Als Adresse übernehmen“

#### Scenario: Ohne Einsatz
- **WHEN** die Person im Dialog „Einsatz anlegen“ die Nadel gezogen hat
- **THEN** fragt das Feld die Ort-Vorschau der Organisation, die nur aufrufen darf, wer Einsätze anlegen darf (sonst 403), mit denselben Grenzen wie die Ort-Vorschau im Einsatz (1 Anfrage je Sekunde, 1,5 s Zeitlimit, derselbe Cache)
- **THEN** stehen der Ortsname ohne Peilung und „Als Adresse übernehmen“ unter dem Ausschnitt; ist der Geocoder ausgelastet oder nicht erreichbar, antwortet der Server mit 200 ohne Ortsname

### Requirement: Auf Karte wählen
„Auf Karte wählen“ SHALL einen Dialog mit einer großen Karte mit Bedienung öffnen, an der
Koordinate des Felds mit Nadel, sonst an der Umgebung (meist der Einsatzort), sonst über
Deutschland. Ein Klick in die Karte SHALL die Nadel setzen, die Nadel ist ziehbar. „Übernehmen“
MUST bis zur ersten Nadel gesperrt sein und setzt die Koordinate, ohne den Text zu ändern;
„Abbrechen“ lässt den Wert. Die Kartengrundlage folgt dem Kartenausschnitt; ohne Netz MUST der
Dialog mit Offline-Karten oder ohne Kacheln weiter gehen. Kann das Gerät keine Karte zeichnen,
MUST im Dialog „Karte auf diesem Gerät nicht darstellbar“ stehen, und „Abbrechen“ MUST gehen.

#### Scenario: Ohne Netz
- **WHEN** das Gerät offline ist und die Person „Auf Karte wählen“ öffnet, in die Karte klickt und übernimmt
- **THEN** trägt der Wert die Koordinate des Klicks, und der Text ist unverändert

#### Scenario: Abbrechen
- **WHEN** die Person im Dialog einen Punkt setzt und „Abbrechen“ wählt
- **THEN** ist der Wert unverändert

### Requirement: Ortsfeld ohne Suche
Eine personenbezogene Ortsangabe (Herkunft / Adresse einer Person) SHALL das Ortsfeld ohne Suche
nehmen: reiner Text ohne „Ort suchen“, ohne Erkennung einer Koordinate, ohne Kartenvorschau und
ohne Ort-Zeile. Ihr Text MUST den Browser nie Richtung Geocoder verlassen, weder über die
Ortssuche noch über die Ort-Vorschau. Enter verhält sich wie in jedem Textfeld.

#### Scenario: Personenadresse
- **WHEN** die Person an einer betroffenen Person „Hauptstraße 12, Musterstadt“ als Herkunft / Adresse einträgt und mit Enter speichert
- **THEN** geht nur der PATCH der Person hinaus und keine Anfrage an Ortssuche oder Ort-Vorschau

### Requirement: Orte in Schäden und Betreuung
Der Ort eines Schadens, der Standort einer Betreuungsstelle und die Sammelstelle eines
Evakuierungsbezirks SHALL beim Anlegen und Bearbeiten das Ortsfeld mit Kartenvorschau und
Ortssuche im Einsatz nehmen; „Auf Karte wählen“ beginnt am Einsatzort. Ein gewählter Treffer,
eine getippte Koordinate oder ein auf der Karte gesetzter Punkt MUST Text und Koordinate
gemeinsam speichern; ohne Auswahl MUST nur der Text gespeichert werden, die Sache bleibt nicht
verortet. Ein geleerter Text MUST auch die Koordinate leeren. Beim Bearbeiten MUST eine
gespeicherte Koordinate als Punkt im Feld stehen und eine Textkorrektur überleben; die
Koordinate MUST nur hinausgehen, wenn sie sich geändert hat. Der Erfassungsdialog eines
Schadens MUST kein eigenes Koordinatenfeld mehr tragen. Ohne Netz MUST der Ort als Freitext oder
getippte Koordinate erfassbar bleiben.

#### Scenario: Schaden mit Treffer erfassen
- **WHEN** die Person im Dialog „Schaden erfassen“ nach „Hauptstr. 17“ sucht und den Treffer „Hauptstraße 17, 12345 Musterstadt“ wählt
- **THEN** trägt der neue Schaden diesen Text als Ort und die Koordinate des Treffers

#### Scenario: Schaden ohne Auswahl
- **WHEN** die Person „Hauptstr. 17“ einträgt, ohne einen Treffer zu wählen, und anlegt
- **THEN** trägt der Schaden den Ort „Hauptstr. 17“ und ist nicht verortet

#### Scenario: Textkorrektur am verorteten Ort
- **WHEN** an einem verorteten Schaden der Ort von „Hauptstr. 17“ auf „Hauptstr. 17a“ berichtigt und gespeichert wird
- **THEN** geht nur der Text hinaus, und der Schaden behält seine Koordinate

#### Scenario: Betreuungsstelle mit Standort anlegen
- **WHEN** die Person beim Anlegen einer Betreuungsstelle unter „Weitere Angaben“ einen Standort-Treffer wählt
- **THEN** trägt die Stelle Standort und Koordinate und erscheint als Marker auf der Lagekarte
