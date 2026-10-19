# Spec Delta

## MODIFIED Requirements

### Requirement: Posten aufteilen

Das System SHALL die Menge eines Verbrauchsguts auf zwei Zeilen aufteilen. Das Aufteilen MUST in
einer Transaktion die Ausgangszeile mindern und eine neue Zeile mit der abgeteilten Menge anlegen,
die Bezeichnung, Stammbezug, Art, Status, Bemerkung, Ort und Dispositionszeitpunkt übernimmt, ohne
Ausgabe beginnt und genau einen ETB-Eintrag schreibt. Die Ausgabe MUST an der Ausgangszeile bleiben.
Die Summe beider Mengen MUST der Ausgangsmenge gleichen. Nennt die Anfrage einen Ort, MUST die neue
Zeile in derselben Transaktion dort stehen statt am Ort der Ausgangszeile, und der eine ETB-Eintrag
MUST auch den Ortswechsel nennen. Der Dialog „Aufteilen …“ SHALL dafür ein Feld „Ort“ tragen,
vorbelegt mit dem Ort der Ausgangszeile.

#### Scenario: 50 Decken
- **WHEN** von 50 Wolldecken 20 abgeteilt werden
- **THEN** gibt es zwei Zeilen mit 30 und 20, beide mit demselben Ort, und das ETB nennt „aufgeteilt: 50 → 30 + 20“

#### Scenario: Teilweise ausgegeben
- **WHEN** von 50 Wolldecken mit Ausgabe 20 genau 20 abgeteilt werden
- **THEN** trägt die Ausgangszeile Menge 30 mit Ausgabe 20 und die neue Zeile Menge 20 ohne Ausgabe

#### Scenario: 20 Decken an die UHS
- **WHEN** von 50 Wolldecken der Einheit „Staffel A“ im Dialog „Aufteilen …“ 20 mit Ort UHS „Turnhalle“ abgeteilt werden
- **THEN** liegen 30 an „Staffel A“ und 20 an der UHS „Turnhalle“, und im ETB steht genau ein Eintrag „Material «Wolldecke» aufgeteilt: 50 → 30 + 20, davon 20: Einheit «Staffel A» → UHS «Turnhalle»“

#### Scenario: Abgeteilter Teil ohne Ort
- **WHEN** von 50 Wolldecken der Einheit „Staffel A“ 20 mit Ort „ohne Ort“ abgeteilt werden
- **THEN** liegen 30 an „Staffel A“ und 20 ohne Ort, mit einem ETB-Eintrag, der „Einheit «Staffel A» → ohne Ort“ nennt

#### Scenario: Ort unverändert gelassen
- **WHEN** die Person im Dialog „Aufteilen …“ das Feld „Ort“ auf dem Ort der Ausgangszeile lässt
- **THEN** stehen beide Zeilen an diesem Ort, und das ETB nennt nur „aufgeteilt: 50 → 30 + 20“

### Requirement: Grenzen des Aufteilens

Die abgeteilte Menge SHALL mindestens 1, kleiner als die Menge und höchstens der Rest des Postens
sein. Unter 1 MUST der Server mit 400 antworten; bei einer Menge ab der Ausgangsmenge, über dem Rest
oder an einem Gerät mit 422; an einem aus dem Einsatz genommenen oder stornierten Posten mit 409; in
keinem Fall MUST etwas geschrieben werden. Ein genannter Ort MUST wie jeder Ortswechsel geprüft
werden (Spec `material-modell`, „Prüfung des Orts“); zwei Orte mit Wert MUST mit 422 abgelehnt
werden, und auch dann MUST nichts geschrieben werden.

#### Scenario: Menge 1
- **WHEN** ein Posten mit Menge 1 aufgeteilt werden soll
- **THEN** antwortet der Server mit 422, und die Liste bietet „Aufteilen“ für ihn nur gesperrt mit dem Grund an

#### Scenario: Mehr als der Rest
- **WHEN** von 50 Wolldecken mit Ausgabe 40 genau 20 abgeteilt werden sollen
- **THEN** antwortet der Server mit 422

#### Scenario: Beendeter Posten
- **WHEN** ein aus dem Einsatz genommener Posten aufgeteilt werden soll
- **THEN** antwortet der Server mit 409

#### Scenario: Aufgelöste UHS als Ziel
- **WHEN** von 50 Wolldecken 20 an eine aufgelöste UHS abgeteilt werden sollen
- **THEN** antwortet der Server mit 422, die Ausgangszeile trägt weiter 50, und es entstehen weder eine neue Zeile noch ein ETB-Eintrag

#### Scenario: Zwei Orte
- **WHEN** eine Anfrage zum Aufteilen eine Einheit und eine UHS zugleich als Ort nennt
- **THEN** antwortet der Server mit 422, und nichts wird geschrieben
