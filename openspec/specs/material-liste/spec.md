# material-liste Specification

## Purpose
Die Materialliste zeigt, was an Material im Einsatz ist, wo es liegt und was davon ausgefallen ist,
und lässt es dort ändern: der eine Ort je Posten (LLH-1224), Menge mit ausdrücklichem
Speichern, Korrektur der Angaben eines Ad-hoc-Postens, Aufteilen einer Menge auf zwei Zeilen und
die Zeilenaktionen mit dem Wortlaut „Aus dem Einsatz nehmen“. Eingeführt mit LLH-1093.

## Requirements

### Requirement: Ort eines Postens in der Materialliste

Die Materialliste SHALL je Posten eine Spalte „Ort“ zeigen, die den einen Ort des Postens nennt:
eine Einheit, ein Fahrzeug, eine Unfallhilfsstelle, einen Bereitstellungsraum oder „ohne Ort“. Kann
die Person das Modul des Orts nicht lesen, MUST die Spalte „zugeordnet“ zeigen statt eines Namens
und nie „—“. Die Liste MUST nach Ort filterbar sein („ohne Ort“, je Einheit, je Fahrzeug, je UHS, je
Bereitstellungsraum); ein Posten
MUST höchstens einem Filterwert entsprechen.

#### Scenario: Posten an einer UHS
- **WHEN** ein Posten der UHS „Turnhalle“ zugeordnet ist
- **THEN** zeigt seine Zeile den Ort „UHS Turnhalle“

#### Scenario: Posten auf einem Fahrzeug
- **WHEN** ein Posten dem Fahrzeug „Florian 1/83-1“ zugeordnet ist
- **THEN** zeigt seine Zeile den Ort „Florian 1/83-1“ und keinen Strich

#### Scenario: Ohne Leserecht auf Einheiten
- **WHEN** eine Person ohne Zugriff auf das Modul Einheiten die Materialliste öffnet
- **THEN** steht beim Posten einer Einheit „zugeordnet“ und kein Strich

### Requirement: Ort in der Liste ändern

Die Materialliste SHALL den Ort eines Postens in der Zeile ändern lassen, mit ausdrücklichem
Speichern. Setzt die Person einen neuen Ort, MUST der bisherige gelöst werden. Ein Teil, dessen
Modul die Person nicht nutzen darf, MUST nur lesbar sein.

#### Scenario: Umhängen aus der Liste
- **WHEN** die Einsatzleitung beim Posten „Wolldecke“ die Einheit von „Staffel A“ auf „Staffel B“ ändert
- **THEN** gehört der Posten zu „Staffel B“ und zu keinem anderen Ort

#### Scenario: Von der Einheit an die UHS
- **WHEN** die Einsatzleitung beim Posten „Wolldecke“ an der Einheit „Staffel A“ die UHS „Turnhalle“ setzt
- **THEN** liegt der Posten an der UHS „Turnhalle“, und der Einheit-Teil ist leer

#### Scenario: Einheiten-Modul gesperrt
- **WHEN** eine Person Material schreiben darf, das Modul Einheiten aber nicht nutzen darf
- **THEN** ist der Einheit-Teil des Orts nur lesbar und der UHS-Teil bedienbar

### Requirement: UHS-Verortung prüft das Ziel

Setzt eine Änderung die UHS eines Postens auf einen anderen Wert, SHALL der Server prüfen, dass die
UHS zum Einsatz gehört, nicht storniert und nicht aufgelöst ist. Eine unbekannte, fremde oder
stornierte UHS MUST mit 404 abgelehnt werden, eine aufgelöste mit 422; in beiden Fällen MUST nichts
geschrieben werden. Das Lösen der UHS und ein unveränderter Wert MUST ohne diese Prüfung gelingen.

#### Scenario: UHS eines anderen Einsatzes
- **WHEN** ein Posten einer UHS aus einem anderen Einsatz zugeordnet werden soll
- **THEN** antwortet der Server mit 404, und der Posten behält seine UHS

#### Scenario: Aufgelöste UHS
- **WHEN** ein Posten einer aufgelösten UHS zugeordnet werden soll
- **THEN** antwortet der Server mit 422

#### Scenario: Lösen von einer aufgelösten UHS
- **WHEN** ein Posten von einer inzwischen aufgelösten UHS gelöst wird
- **THEN** gelingt das Lösen

### Requirement: Umhängen nennt die alte Einheit

Wechselt ein Posten seinen Ort, SHALL der ETB-Eintrag den alten und den neuen Ort nennen, und beide
Orte MUST live aktualisiert werden. Die Zuordnung an den Ort, an dem der Posten schon ist, MUST
nichts schreiben.

#### Scenario: Von A nach B
- **WHEN** „Wolldecke“ (×20) von „Staffel A“ an „Staffel B“ gehängt wird
- **THEN** steht im ETB „Material «Wolldecke» (×20): Einheit «Staffel A» → Einheit «Staffel B»“, und die Ansicht von „Staffel A“ zeigt den Posten nicht mehr

#### Scenario: Dieselbe Einheit
- **WHEN** ein Posten erneut seiner eigenen Einheit zugeordnet wird
- **THEN** entsteht kein ETB-Eintrag

### Requirement: Ad-hoc-Angaben korrigieren

Das System SHALL Bezeichnung, Kategorie, Trägerorganisation und Bestandsnummer eines
Ad-hoc-Postens im Einsatz ändern lassen. Bei einem Posten aus dem Materialstamm MUST eine Änderung
dieser Angaben mit 422 „im Stamm pflegen“ abgelehnt werden, ohne irgendetwas aus der Anfrage zu
schreiben.

#### Scenario: Tippfehler korrigiert
- **WHEN** die Bezeichnung eines Ad-hoc-Postens von „Feldbeten“ auf „Feldbetten“ geändert wird
- **THEN** zeigen Liste, Einheit und UHS „Feldbetten“

#### Scenario: Stamm-Posten
- **WHEN** die Kategorie eines Stamm-Postens über den Einsatz geändert werden soll
- **THEN** antwortet der Server mit 422 „im Stamm pflegen“, und nichts ist geändert

### Requirement: Grenzen der Materialangaben

Bezeichnung, Kategorie, Trägerorganisation und Bestandsnummer eines Ad-hoc-Postens SHALL beim
Disponieren und beim Ändern höchstens 200 Zeichen lang sein, eine Bemerkung höchstens 2 000.
Überlänge und eine leere Bezeichnung MUST mit 400 abgelehnt werden, vor jeder Prüfung des
Zusammenhangs.

#### Scenario: Zu lang
- **WHEN** eine Bezeichnung mit 201 Zeichen geschickt wird
- **THEN** antwortet der Server mit 400, auch bei einem Stamm-Posten

### Requirement: Korrektur steht im ETB

Eine Änderung der Ad-hoc-Angaben SHALL genau einen ETB-Eintrag schreiben, der jede geänderte Angabe
mit altem und neuem Wert nennt. Ändert sich keine Angabe, MUST kein Eintrag entstehen.

#### Scenario: Zwei Angaben in einem Eintrag
- **WHEN** Bezeichnung und Kategorie eines Ad-hoc-Postens zugleich geändert werden
- **THEN** steht im ETB ein Eintrag „Material «Feldbetten»: Bezeichnung «Feldbeten» → «Feldbetten», Kategorie «—» → «Betreuung»“

#### Scenario: Nichts geändert
- **WHEN** die Angaben unverändert gesendet werden
- **THEN** entsteht kein ETB-Eintrag

### Requirement: Posten aufteilen

Das System SHALL die Menge eines Verbrauchsguts auf zwei Zeilen aufteilen. Das Aufteilen MUST in
einer Transaktion die Ausgangszeile mindern und eine neue Zeile mit der abgeteilten Menge anlegen,
die Bezeichnung, Stammbezug, Art, Status, Bemerkung, Ort und Dispositionszeitpunkt übernimmt, ohne
Ausgabe beginnt und genau einen ETB-Eintrag schreibt. Die Ausgabe MUST an der Ausgangszeile bleiben.
Die Summe beider Mengen MUST der Ausgangsmenge gleichen.

#### Scenario: 50 Decken
- **WHEN** von 50 Wolldecken 20 abgeteilt werden
- **THEN** gibt es zwei Zeilen mit 30 und 20, beide mit demselben Ort, und das ETB nennt „aufgeteilt: 50 → 30 + 20“

#### Scenario: Teilweise ausgegeben
- **WHEN** von 50 Wolldecken mit Ausgabe 20 genau 20 abgeteilt werden
- **THEN** trägt die Ausgangszeile Menge 30 mit Ausgabe 20 und die neue Zeile Menge 20 ohne Ausgabe

### Requirement: Grenzen des Aufteilens

Die abgeteilte Menge SHALL mindestens 1, kleiner als die Menge und höchstens der Rest des Postens
sein. Unter 1 MUST der Server mit 400 antworten; bei einer Menge ab der Ausgangsmenge, über dem Rest
oder an einem Gerät mit 422; an einem aus dem Einsatz genommenen oder stornierten Posten mit 409; in
keinem Fall MUST etwas geschrieben werden.

#### Scenario: Menge 1
- **WHEN** ein Posten mit Menge 1 aufgeteilt werden soll
- **THEN** antwortet der Server mit 422, und die Liste bietet „Aufteilen“ für ihn nur gesperrt mit dem Grund an

#### Scenario: Mehr als der Rest
- **WHEN** von 50 Wolldecken mit Ausgabe 40 genau 20 abgeteilt werden sollen
- **THEN** antwortet der Server mit 422

#### Scenario: Beendeter Posten
- **WHEN** ein aus dem Einsatz genommener Posten aufgeteilt werden soll
- **THEN** antwortet der Server mit 409

### Requirement: Menge mit ausdrücklichem Speichern

Die Materialliste SHALL die Menge eines Postens als Wert zeigen, der erst auf eine Handlung zum
Bearbeiten wird. Eine geänderte Menge MUST nur mit Enter oder „Speichern“ gesendet werden, nie beim
Verlassen des Felds.

#### Scenario: Wisch auf dem Tablet
- **WHEN** die Person das Mengenfeld öffnet, eine Ziffer ändert und daneben tippt
- **THEN** wird nichts gesendet, und die Menge bleibt unverändert

### Requirement: Materialverdichtung

Über der Materialliste SHALL eine Verdichtung die aktiven Posten nach einsatzbereit, im Einsatz und
Ausfall zählen; die Gesamtzahl der Posten MUST im Seitenkopf stehen. Ausfall MUST jeden Status
umfassen, dessen Rolle im Statusvertrag Alarm oder Achtung ist (defekt, verbraucht, Desinfektion
nötig), und jedes aufgebrauchte Verbrauchsgut. Gezählt MUST in Posten werden, nicht in Mengen, mit
derselben Funktion, die die Material-Gruppenzeile im Meldebild zählt. Personal- oder Fahrzeugzahlen
MUST NOT auf der Materialseite stehen.

#### Scenario: Zählung
- **WHEN** von zwölf Posten sieben einsatzbereit, drei im Einsatz, einer defekt und ein Verbrauchsgut aufgebraucht sind
- **THEN** steht über der Liste „7 einsatzbereit · 3 im Einsatz · 2 Ausfall“ und im Kopf „12 Posten“

#### Scenario: Teilweise ausgegeben
- **WHEN** ein einsatzbereites Verbrauchsgut 30 von 50 übrig hat
- **THEN** zählt es als einsatzbereit, nicht als Ausfall

#### Scenario: Jeder Status in genau einem Topf
- **WHEN** der Statusvertrag des Materials geprüft wird
- **THEN** fällt jeder Materialstatus in genau einen der drei Töpfe

### Requirement: Zeilenaktionen der Materialliste

Jede Zeile der Materialliste SHALL für schreibberechtigte Personen „Aus dem Einsatz nehmen“
sichtbar anbieten und „Angaben ändern“, „Aufteilen“ und „Stornieren“ in einem Zeilenmenü bündeln,
dessen Name den Posten nennt. Ein gerade nicht möglicher Eintrag MUST gesperrt mit seinem Grund im
Etikett stehen. „Stornieren“ MUST rot hinter einem Trenner stehen und vor dem Senden in einem
Dialog mit dem Knopf „Stornieren“ rückfragen.

#### Scenario: Stamm-Posten im Menü
- **WHEN** die Person das Zeilenmenü eines Stamm-Postens öffnet
- **THEN** steht „Angaben ändern · im Stamm pflegen“ gesperrt darin

#### Scenario: Stornieren fragt im Dialog
- **WHEN** die Person im Zeilenmenü „Stornieren“ wählt
- **THEN** öffnet sich ein Dialog mit dem Knopf „Stornieren“, und erst dieser sendet

### Requirement: Wortlaut für Material

Für Material SHALL „Aus dem Einsatz nehmen“ statt „Entlassen“ gelten: am Knopf, im Hinweis mit
Rückgängig, im Block der beendeten Posten („Aus dem Einsatz genommen“) und im ETB. Ein Posten
MUST ohne Rückfrage aus dem Einsatz genommen werden.

#### Scenario: Aus dem Einsatz nehmen
- **WHEN** die Person bei „Wolldecke“ „Aus dem Einsatz nehmen“ wählt
- **THEN** geschieht es ohne Rückfrage, ein Hinweis „Wolldecke aus dem Einsatz genommen“ bietet Rückgängig an, und der Posten steht im Block „Aus dem Einsatz genommen“
