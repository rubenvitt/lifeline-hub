# material-liste Specification

## Purpose
Die Materialliste zeigt, was an Material im Einsatz ist, wo es liegt und was davon ausgefallen ist,
und lässt es dort ändern: der eine Ort je Posten als eine Angabe (LLH-1224, LLH-1225), gruppiert
nach Ort oder Status, Ausgabe eines Verbrauchsguts, Menge und Art über das Zeilenmenü, Korrektur
der Angaben eines Ad-hoc-Postens, Aufteilen einer Menge auf zwei Zeilen, Art und Ort beim
Disponieren und die Zeilenaktionen mit dem Wortlaut „Aus dem Einsatz nehmen“. Eingeführt mit
LLH-1093.

## Requirements

### Requirement: Ort eines Postens in der Materialliste

Die Materialliste SHALL je Posten eine Spalte „Ort“ zeigen, die den einen Ort des Postens nennt:
eine Einheit, ein Fahrzeug, eine Unfallhilfsstelle, einen Bereitstellungsraum oder „ohne Ort“. Kann
die Person das Modul des Orts nicht lesen, MUST die Spalte „zugeordnet“ zeigen statt eines Namens
und nie „—“. Die Liste MUST nach Ort filterbar sein („ohne Ort“, je Einheit, je Fahrzeug, je UHS,
je Bereitstellungsraum); ein Posten MUST genau einem Filterwert entsprechen.

#### Scenario: Posten an einer UHS
- **WHEN** ein Posten der UHS „Turnhalle“ zugeordnet ist
- **THEN** zeigt seine Zeile den Ort „UHS Turnhalle“

#### Scenario: Posten auf einem Fahrzeug
- **WHEN** ein Posten dem Fahrzeug „Florian 1/83-1“ zugeordnet ist
- **THEN** zeigt seine Zeile den Ort „Florian 1/83-1“ und keinen Strich

#### Scenario: Ohne Leserecht auf Einheiten
- **WHEN** eine Person ohne Zugriff auf das Modul Einheiten die Materialliste öffnet
- **THEN** steht beim Posten einer Einheit „zugeordnet“ und kein Strich

#### Scenario: Filter Bereitstellungsraum
- **WHEN** die Person in der Spalte „Ort“ nach dem Bereitstellungsraum „BR Nord“ filtert
- **THEN** stehen nur die Posten in „BR Nord“ in der Liste

### Requirement: Ort in der Liste ändern

Die Materialliste SHALL den Ort eines Postens in der Zeile als eine Angabe ändern lassen, mit
ausdrücklichem Speichern. Die Auswahl MUST „ohne Ort“ und je Ortsart (Einheiten, Fahrzeuge,
Unfallhilfsstellen, Bereitstellungsräume) die wählbaren Orte anbieten; eine Ortsart, deren Modul die
Person nicht lesen darf, MUST fehlen. Setzt die Person einen neuen Ort, MUST der bisherige in
derselben Anfrage gelöst werden. Die Änderung MUST über die Material-Disposition laufen und das
Recht auf Material verlangen, nicht das Recht des Zielmoduls.

#### Scenario: Umhängen aus der Liste
- **WHEN** die Einsatzleitung beim Posten „Wolldecke“ den Ort von „Staffel A“ auf „Staffel B“ ändert
- **THEN** gehört der Posten zu „Staffel B“ und zu keinem anderen Ort

#### Scenario: Von der Einheit an die UHS
- **WHEN** die Einsatzleitung beim Posten „Wolldecke“ an der Einheit „Staffel A“ den Ort „UHS Turnhalle“ wählt und speichert
- **THEN** liegt der Posten an der UHS „Turnhalle“ und an keiner Einheit mehr

#### Scenario: Verlassen ohne Speichern
- **WHEN** die Person die Ort-Angabe öffnet, einen anderen Ort wählt und daneben tippt
- **THEN** wird nichts gesendet

#### Scenario: Ohne Leserecht auf Bereitstellungsräume
- **WHEN** eine Person ohne Zugriff auf das Modul Bereitstellungsräume die Ort-Angabe öffnet
- **THEN** bietet die Auswahl keine Bereitstellungsräume an, und die übrigen Ortsarten stehen da

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

Die Materialliste SHALL die Menge eines Postens als Wert ohne Eingabefeld in der Zeile zeigen. Die
Gesamtmenge eines Verbrauchsguts MUST über „Menge ändern …“ im Zeilenmenü in einem Dialog geändert
werden, der nur mit Enter oder „Speichern“ sendet. Die Menge eines Geräts MUST ohne Bedienung
stehen.

#### Scenario: Wisch auf dem Tablet
- **WHEN** die Person auf dem Tablet über die Mengenzelle wischt und daneben tippt
- **THEN** wird nichts gesendet, und die Menge bleibt unverändert

#### Scenario: Menge eines Verbrauchsguts erhöhen
- **WHEN** die Person bei 50 Wolldecken „Menge ändern …“ wählt, 80 einträgt und „Speichern“ drückt
- **THEN** trägt der Posten die Menge 80

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
sichtbar anbieten und die übrigen Handlungen in einem Zeilenmenü bündeln, dessen Name den Posten
nennt: bei einem Verbrauchsgut „Menge ändern …“, „Ausgabe zurücknehmen …“, „Aufteilen …“, „Als
Gerät führen“, „Angaben ändern …“ und „Stornieren“; bei einem Gerät „Als Verbrauchsgut führen“,
„Angaben ändern …“ und „Stornieren“. Die Einträge zur Art MUST nur ein Ad-hoc-Posten tragen; ein
Stamm-Posten trägt die Art seines Stammeintrags (LLH-1224). Ein Eintrag, den es für die Art gibt, der aber gerade nicht
möglich ist, MUST gesperrt mit seinem Grund im Etikett stehen. „Stornieren“ MUST rot hinter einem
Trenner stehen und vor dem Senden in einem Dialog mit dem Knopf „Stornieren“ rückfragen.

#### Scenario: Stamm-Posten im Menü
- **WHEN** die Person das Zeilenmenü eines Stamm-Postens öffnet
- **THEN** steht „Angaben ändern · im Stamm pflegen“ gesperrt darin

#### Scenario: Stornieren fragt im Dialog
- **WHEN** die Person im Zeilenmenü „Stornieren“ wählt
- **THEN** öffnet sich ein Dialog mit dem Knopf „Stornieren“, und erst dieser sendet

#### Scenario: Nichts ausgegeben
- **WHEN** die Person das Zeilenmenü eines Verbrauchsguts ohne Ausgabe öffnet
- **THEN** steht „Ausgabe zurücknehmen · nichts ausgegeben“ gesperrt darin

#### Scenario: Gerät ohne Mengeneinträge
- **WHEN** die Person das Zeilenmenü eines Geräts öffnet
- **THEN** stehen darin weder „Menge ändern …“ noch „Ausgabe zurücknehmen …“ noch „Aufteilen …“

### Requirement: Gruppierung nach Ort oder Status

Die Materialliste SHALL sich nach Ort oder nach Status gruppieren lassen, mit der Vorgabe Ort. Nach
Ort MUST jeder Posten in genau einer Gruppe stehen, in der Folge Einheiten, Fahrzeuge,
Unfallhilfsstellen, Bereitstellungsräume und zuletzt „ohne Ort“. Die Verdichtung über der Liste
MUST unabhängig von der Gruppierung dieselben Zahlen zeigen.

#### Scenario: Vorgabe beim Öffnen
- **WHEN** die Person die Materialliste öffnet
- **THEN** ist die Liste nach Ort gruppiert, und „ohne Ort“ steht als letzte Gruppe

#### Scenario: Umschalten auf Status
- **WHEN** die Person „Nach Status“ wählt
- **THEN** ist die Liste nach Status gruppiert, und die Verdichtung bleibt unverändert

### Requirement: Ausgabe in der Liste

Die Materialliste SHALL bei einem Verbrauchsgut die Menge mit dem Rest zeigen („30 von 50 übrig“)
und, solange ein Rest bleibt, in der Mengenzelle „Ausgeben“ anbieten. Der Dialog MUST die
auszugebende Menge zwischen 1 und dem Rest nehmen und den Rest danach zeigen; „Ausgabe
zurücknehmen …“ MUST eine Menge zwischen 1 und der Ausgabe zurücknehmen. Beide MUST ohne Rückfrage
senden und eine Ablehnung im Dialog zeigen.

#### Scenario: Decken ausgeben
- **WHEN** die Person bei 50 Wolldecken ohne Ausgabe „Ausgeben“ wählt und 20 ausgibt
- **THEN** zeigt die Zeile „30 von 50 übrig“, und das ETB nennt „Ausgabe 0 → 20 (Rest 30 von 50)“

#### Scenario: Aufgebraucht
- **WHEN** von 50 Wolldecken alle ausgegeben sind
- **THEN** zeigt die Zeile „0 von 50 übrig“ ohne „Ausgeben“, und der Status heißt „aufgebraucht“

#### Scenario: Mehr als der Rest
- **WHEN** die Person bei einem Rest von 30 die Menge 40 ausgeben will
- **THEN** sendet der Dialog nicht und nennt die Grenze

### Requirement: Art eines Postens in der Liste wechseln

Die Materialliste SHALL die Art eines Ad-hoc-Postens im Zeilenmenü wechseln lassen, ohne Rückfrage. Ist
der Wechsel nicht möglich, MUST der Eintrag gesperrt mit dem Grund stehen: zu Gerät bei einer Menge
über 1 oder einer gebuchten Ausgabe, zu Verbrauchsgut bei Status „verbraucht“ oder „Desinfektion
nötig“.

#### Scenario: Ad-hoc-Wolldecke als Gerät angelegt
- **WHEN** die Person bei einem Ad-hoc-Posten „Wolldecke“ (Gerät, Menge 1) „Als Verbrauchsgut führen“ wählt
- **THEN** ist der Posten ein Verbrauchsgut, und seine Mengenzelle bietet „Ausgeben“ an

#### Scenario: Verbrauchsgut mit Menge 50
- **WHEN** die Person das Zeilenmenü von 50 Ad-hoc-Wolldecken öffnet
- **THEN** steht „Als Gerät führen · Menge über 1“ gesperrt darin

### Requirement: Art und Ort beim Disponieren

Die Disponier-Dialoge SHALL optional einen Ort mit derselben Auswahl wie die Spalte „Ort“ nehmen;
der Posten MUST nach dem Disponieren an diesem Ort stehen. Der Ad-hoc-Dialog MUST eine Art anbieten,
deren Vorgabe der Menge folgt (über 1 Verbrauchsgut, sonst Gerät), bis die Person selbst wählt; bei
Gerät MUST die Menge 1 betragen und gesperrt sein.

#### Scenario: Anlieferung an die UHS
- **WHEN** die Person im Stamm-Dialog „Wolldecke“ mit Menge 50 und Ort „UHS Turnhalle“ disponiert
- **THEN** steht der neue Posten an der UHS „Turnhalle“, und im Serienmodus bleibt der Ort für den nächsten Eintrag stehen

#### Scenario: Ad-hoc-Sandsäcke
- **WHEN** die Person Ad-hoc-Material „Sandsäcke“ mit Menge 200 erfasst, ohne die Art zu wählen
- **THEN** zeigt der Dialog „Verbrauchsgut“, und der Posten wird als Verbrauchsgut angelegt

### Requirement: Wortlaut für Material

Für Material SHALL „Aus dem Einsatz nehmen“ statt „Entlassen“ gelten: am Knopf, im Hinweis mit
Rückgängig, im Block der beendeten Posten („Aus dem Einsatz genommen“) und im ETB. Ein Posten
MUST ohne Rückfrage aus dem Einsatz genommen werden.

#### Scenario: Aus dem Einsatz nehmen
- **WHEN** die Person bei „Wolldecke“ „Aus dem Einsatz nehmen“ wählt
- **THEN** geschieht es ohne Rückfrage, ein Hinweis „Wolldecke aus dem Einsatz genommen“ bietet Rückgängig an, und der Posten steht im Block „Aus dem Einsatz genommen“
