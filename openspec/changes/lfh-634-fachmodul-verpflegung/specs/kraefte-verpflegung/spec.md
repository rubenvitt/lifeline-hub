# Spec Delta

## Purpose

Die Führung und S4 sehen je Verpflegungszeitfenster, wie viele Essensportionen gebraucht und
ausgegeben wurden, und erkennen eine Unterdeckung, bevor jemand leer ausgeht. Nachschub
läuft dabei über die bestehende Nachforderung und bekommt keine zweite Wahrheit.

## ADDED Requirements

### Requirement: Verpflegungszeitfenster

Das System SHALL je Einsatz Verpflegungszeitfenster führen. Ein Zeitfenster trägt eine
Bezeichnung (z. B. „Mittag“), Beginn und Ende sowie einen erfassten Bedarf in
Essensportionen (EP), aufgeteilt in Einsatzkräfte, Betreute und weitere Personen. Der
Gesamtbedarf MUST die Summe dieser drei Teile sein. Das System MUST sich überschneidende
Zeitfenster zulassen; Zeitfenster sind an keine Schicht einer Einheit gebunden.

#### Scenario: Zeitfenster anlegen
- **WHEN** eine Person mit Schreibrecht das Zeitfenster „Mittag“ von 12:00 bis 13:30 mit Bedarf 180 Einsatzkräfte, 70 Betreute und 0 weitere anlegt
- **THEN** entsteht ein Zeitfenster mit Gesamtbedarf 250 EP

#### Scenario: Leere Bezeichnung oder negativer Bedarf
- **WHEN** ein Zeitfenster mit leerer Bezeichnung, ohne Beginn oder Ende oder mit einem negativen Bedarfsteil angelegt wird
- **THEN** antwortet das System mit 400 und legt nichts an

#### Scenario: Ende nicht nach Beginn
- **WHEN** ein Zeitfenster angelegt oder geändert wird, dessen Ende nicht nach dem Beginn liegt
- **THEN** antwortet das System mit 422 und ändert nichts

### Requirement: Sonderkost als Teilmenge

Das System SHALL am Bedarf eines Zeitfensters und an jeder Ausgabe eine Anzahl je Kostform
führen. Die Kostformen sind fest: vegetarisch, vegan, ohne Schweinefleisch,
Diät/allergenarm, Säugling/Kleinkind. Sonderkost ist eine **Teilmenge** der EP, kein
Zuschlag: Die Summe aller Kostformen MUST den Gesamtbedarf bzw. die Menge der Ausgabe nicht
übersteigen, der Rest ist Normalkost. Sonderkost MUST ohne Personenbezug geführt werden.

#### Scenario: Sonderkost im Bedarf
- **WHEN** ein Zeitfenster mit Gesamtbedarf 250 und Sonderkost 12 vegetarisch, 3 vegan angelegt wird
- **THEN** stehen am Zeitfenster 12 vegetarisch, 3 vegan und 235 Normalkost

#### Scenario: Sonderkost übersteigt die Menge
- **WHEN** die Summe der Kostformen größer ist als der Gesamtbedarf oder die Menge einer Ausgabe, auch nach einer Änderung des Bedarfs
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Negative Anzahl einer Kostform
- **WHEN** eine Kostform mit einer negativen Anzahl übergeben wird
- **THEN** antwortet das System mit 400

### Requirement: Zeitfenster ändern und löschen

Das System SHALL Bezeichnung, Beginn, Ende, Bedarf und Sonderkost eines Zeitfensters
änderbar machen. Ein Zeitfenster MUST sich nur löschen lassen, solange es keine nicht
zurückgenommene Ausgabe hat; zurückgenommene Ausgaben werden mit ihm entfernt.

#### Scenario: Bedarf erhöhen
- **WHEN** der Bedarf Betreute eines Zeitfensters von 70 auf 90 geändert wird
- **THEN** beträgt der Gesamtbedarf 270 EP und die Fehlmenge steigt um 20

#### Scenario: Löschen mit Ausgaben
- **WHEN** ein Zeitfenster mit mindestens einer gültigen Ausgabe gelöscht werden soll
- **THEN** antwortet das System mit 422 und löscht nichts

#### Scenario: Zeitfenster eines anderen Einsatzes
- **WHEN** ein Zeitfenster über einen fremden Einsatz geändert, gelöscht oder mit einer Ausgabe belegt werden soll
- **THEN** antwortet das System mit 404

### Requirement: Ausgabe erfassen

Das System SHALL je Zeitfenster Ausgaben führen. Eine Ausgabe trägt Zeitpunkt, Menge in EP,
optional Ort, Sonderkost je Kostform, optional den Verweis auf eine Nachforderung und
optional eine Bemerkung. Ausgaben MUST append-only sein: Es gibt keine Bearbeitung, eine
falsche Ausgabe wird zurückgenommen. Das System MUST einen Zeitpunkt außerhalb des
Zeitfensters annehmen (Anlieferung vor Beginn).

#### Scenario: Ausgabe erfassen
- **WHEN** zum Zeitfenster „Mittag“ eine Ausgabe von 120 EP am Ort „Verpflegungsstelle Deich“ um 11:40 erfasst wird
- **THEN** ist die Ausgabe am Zeitfenster sichtbar und zählt in die ausgegebene Menge

#### Scenario: Zeitpunkt fehlt
- **WHEN** eine Ausgabe ohne Zeitpunkt erfasst wird
- **THEN** gilt der Zeitpunkt der Erfassung

#### Scenario: Menge nicht positiv
- **WHEN** eine Ausgabe mit einer Menge ≤ 0 erfasst wird
- **THEN** antwortet das System mit 400

#### Scenario: Rückgängig nach dem Erfassen
- **WHEN** eine Person eine Ausgabe über den Dialog erfasst hat
- **THEN** zeigt die Seite einen Hinweis mit der Aktion „Rückgängig“, die die Ausgabe zurücknimmt

### Requirement: Ausgabe zurücknehmen

Das System SHALL eine Ausgabe zurücknehmen können. Eine zurückgenommene Ausgabe MUST
sichtbar bleiben, als zurückgenommen gekennzeichnet sein und nicht mehr in die ausgegebene
Menge zählen. Eine Rücknahme ist endgültig; die Oberfläche MUST vor einer Rücknahme aus der
Liste heraus rückfragen, mit rot gekennzeichnetem Bestätigungsknopf.

#### Scenario: Rücknahme
- **WHEN** die Ausgabe über 120 EP zurückgenommen wird
- **THEN** sinkt die ausgegebene Menge um 120 und die Ausgabe steht als „zurückgenommen“ in der Liste

#### Scenario: Zweite Rücknahme
- **WHEN** eine bereits zurückgenommene Ausgabe erneut zurückgenommen wird
- **THEN** antwortet das System mit 422

### Requirement: Deckung und Unterdeckung

Das System SHALL je Zeitfenster Gesamtbedarf, ausgegebene Menge und Fehlmenge
(Bedarf − ausgegeben, nicht kleiner als 0) liefern, jeweils gesamt und je Kostform. Die
Oberfläche MUST jedes Zeitfenster mit einer Einstufung zeigen, die aus Wort und Rollenfarbe
besteht (zweiter Kanal, WCAG 1.4.1):

- „gedeckt“ (normal), wenn keine Fehlmenge besteht, weder gesamt noch in einer Kostform,
- „offen“ (neutral), wenn eine Fehlmenge besteht und das Zeitfenster noch nicht begonnen hat,
- „Unterdeckung“ (Alarm), wenn eine Fehlmenge besteht und das Zeitfenster begonnen hat.

Die Fehlmenge MUST immer als Zahl dastehen, auch bei „offen“. Nichts davon darf blinken.

#### Scenario: Unterdeckung im laufenden Zeitfenster
- **WHEN** das Zeitfenster „Mittag“ (Bedarf 250) um 12:00 begonnen hat und 230 EP ausgegeben sind
- **THEN** zeigt es Fehlmenge 20, das Wort „Unterdeckung“ und die Alarmfarbe, ohne Animation

#### Scenario: Fehlmenge vor Beginn
- **WHEN** ein Zeitfenster erst in zwei Stunden beginnt und noch keine Ausgabe hat
- **THEN** zeigt es die volle Fehlmenge als Zahl und das Wort „offen“ ohne Alarmfarbe

#### Scenario: Sonderkost fehlt trotz Gesamtdeckung
- **WHEN** 250 EP ausgegeben sind, davon 0 vegan, bei einem Bedarf von 250 mit 3 vegan, und das Zeitfenster hat begonnen
- **THEN** zeigt es Fehlmenge 3 vegan und die Einstufung „Unterdeckung“

#### Scenario: Überdeckung
- **WHEN** mehr EP ausgegeben sind als gebraucht
- **THEN** ist die Fehlmenge 0 und die Einstufung „gedeckt“

### Requirement: Bedarfsvorschläge aus Personal und Betreuung

Die Oberfläche SHALL beim Anlegen eines Zeitfensters den Bedarf vorbelegen: die
Einsatzkräfte mit der aktuellen Personalstärke des Einsatzes, die Betreuten mit der Kopfzahl
„in Betreuung“ zum Beginn des Zeitfensters. Der Bedarf wird gespeichert und danach nicht
mehr aus den Quellen nachgerechnet. Jeder Vorschlag MUST sichtbar beschriftet und
überschreibbar sein. Liefert eine Quelle nichts, MUST das Feld leer bleiben statt 0 zu
zeigen. Eine Quelle, deren Modul der Person nicht zugänglich ist (ausgeblendet, per Rolle
gesperrt oder vom Server mit 403 abgelehnt), MUST ohne Fehler und ohne Wiederholungsversuch
entfallen.

#### Scenario: Vorschlag aus beiden Quellen
- **WHEN** der Einsatz 186 Personen im Personal führt und für den Beginn des Zeitfensters 70 Personen in Betreuung gemeldet sind
- **THEN** stehen 186 und 70 vorbelegt in den Bedarfsfeldern, jeweils mit Herkunftsangabe

#### Scenario: Betreuung ohne Meldung
- **WHEN** im Einsatz keine Betreuungsstelle eine Belegung gemeldet hat
- **THEN** bleibt das Feld Betreute leer und trägt den Hinweis, dass nichts gemeldet ist

#### Scenario: Kopfzahl ist eine Untergrenze
- **WHEN** zum Beginn des Zeitfensters mindestens eine Betreuungsstelle ohne Meldung existiert
- **THEN** trägt der Vorschlag den Hinweis, dass er eine Untergrenze ist

#### Scenario: Zeitfenster in der Zukunft
- **WHEN** das Zeitfenster nach dem aktuellen Zeitpunkt beginnt
- **THEN** trägt der Betreuungsvorschlag den Hinweis, dass er den heutigen Stand zeigt

#### Scenario: Betreuung nicht zugänglich
- **WHEN** das Modul Betreuung für die Person ausgeblendet ist
- **THEN** öffnet der Dialog ohne Fehlermeldung, und das Feld Betreute bleibt ohne Vorschlag

#### Scenario: Späterer Personalzuwachs
- **WHEN** nach dem Anlegen eines Zeitfensters weiteres Personal in den Einsatz kommt
- **THEN** bleiben Bedarf und Fehlmenge des Zeitfensters unverändert

### Requirement: Bezug zur Nachforderung

Das System SHALL keinen eigenen Liefer- oder Bestellstatus für Verpflegung führen. Eine
Ausgabe SHALL optional auf eine Nachforderung desselben Einsatzes verweisen. Eine Ausgabe MUST den
Status der Nachforderung nicht ändern. Die Antwort des Verpflegungsmoduls MUST vom Verweis nur
die Kennung tragen, keine Angaben der Nachforderung. Die Oberfläche SHALL bei einer
Fehlmenge das Nachfordern anbieten, indem sie die Erfassung einer Nachforderung mit Art,
Bezeichnung, Anzahl (Fehlmenge) und Begründung vorbelegt öffnet; dies nur, wenn das Modul
Nachforderungen der Person zugänglich ist.

#### Scenario: Ausgabe mit Nachforderung
- **WHEN** eine Ausgabe mit Verweis auf die Nachforderung „Verpflegung 60 EP“ desselben Einsatzes erfasst wird
- **THEN** trägt die Ausgabe die Kennung der Nachforderung, und deren Status bleibt unverändert

#### Scenario: Nachforderung eines anderen Einsatzes
- **WHEN** eine Ausgabe auf eine Nachforderung eines anderen Einsatzes verweist
- **THEN** antwortet das System mit 404 und legt nichts an

#### Scenario: Nachfordern aus der Unterdeckung
- **WHEN** eine Person bei einem Zeitfenster mit Fehlmenge 20 „Nachfordern“ wählt
- **THEN** öffnet die Nachforderungsseite ihre Erfassung mit Art „Verpflegung“, Anzahl 20 und einer Bezeichnung und Begründung, die das Zeitfenster nennen
- **AND** die Vorbelegung steht danach nicht mehr in der Adresse

#### Scenario: Unbrauchbare Vorbelegung
- **WHEN** die Nachforderungsseite mit einer Vorbelegung aufgerufen wird, deren Anzahl keine positive Ganzzahl ist
- **THEN** verwirft sie die Vorbelegung ganz und öffnet die Erfassung leer

### Requirement: Einsatztagebuch

Anlegen, Ändern und Löschen eines Zeitfensters MUST in derselben Transaktion einen
System-Eintrag im ETB schreiben, der Bezeichnung, Zeitraum und Gesamtbedarf nennt (bei
Änderung auch den vorherigen Gesamtbedarf). Der Zeitraum MUST in der Zeitzone der
Organisation stehen, nicht in UTC. Das Erfassen und Zurücknehmen einer Ausgabe
MUST keinen ETB-Eintrag schreiben.

#### Scenario: Bedarf geändert
- **WHEN** der Gesamtbedarf des Zeitfensters „Mittag“ von 250 auf 270 geändert wird
- **THEN** enthält das ETB einen System-Eintrag, der „Mittag“, den Zeitraum, 270 EP und den vorherigen Wert 250 nennt

#### Scenario: Zeitraum in Ortszeit
- **WHEN** die Organisation die Zeitzone Europe/Berlin führt und ein Zeitfenster am 24.09. von 10:00 bis 11:30 UTC angelegt wird
- **THEN** nennt der ETB-Eintrag den Zeitraum 24.09. 12:00–13:30

#### Scenario: Ausgabe ohne ETB
- **WHEN** eine Ausgabe erfasst oder zurückgenommen wird
- **THEN** entsteht kein neuer ETB-Eintrag

### Requirement: Rechte und Modulsichtbarkeit

Lesende Endpunkte MUST Lesezugriff auf den Einsatz und das Modul Verpflegung verlangen,
schreibende Endpunkte zusätzlich Schreibrecht und einen aktiven Einsatz. Ist das Modul im
Einsatz ausgeblendet, MUST das System 403 liefern. Die Oberfläche MUST ohne Schreibrecht
einen Hinweis mit Grund zeigen, die Primäraktion gesperrt stehen lassen und die
Zeilenaktionen weglassen.

#### Scenario: Beobachter liest
- **WHEN** eine Person ohne Schreibrecht die Zeitfenster abruft
- **THEN** erhält sie die Zeitfenster mit Ausgaben und Deckung

#### Scenario: Beobachter erfasst
- **WHEN** eine Person ohne Schreibrecht eine Ausgabe erfasst
- **THEN** antwortet das System mit 403

#### Scenario: Modul ausgeblendet
- **WHEN** das Modul Verpflegung im Einsatz ausgeblendet ist und die Zeitfenster abgerufen werden
- **THEN** antwortet das System mit 403

#### Scenario: Abgeschlossener Einsatz
- **WHEN** in einem abgeschlossenen Einsatz ein Zeitfenster angelegt wird
- **THEN** antwortet das System mit 409 und legt nichts an

### Requirement: Live-Verteilung

Jede Änderung an Zeitfenstern und Ausgaben MUST nach dem Commit ein Live-Ereignis
`verpflegung` an alle verbundenen Clients des Einsatzes auslösen, die das Modul Verpflegung
lesen dürfen. Die Nutzlast MUST nur Kennungen tragen. Ein zugehöriger ETB-Eintrag MUST
zusätzlich als ETB-Ereignis verteilt werden. Neue Zeitfenster anderer Personen MUST die
Liste nicht unter dem Cursor verschieben, sondern als Sammelhinweis erscheinen.

#### Scenario: Zweiter Client sieht die Ausgabe
- **WHEN** Client A eine Ausgabe erfasst, während Client B die Verpflegungsseite desselben Einsatzes geöffnet hat
- **THEN** zeigt Client B die neue ausgegebene Menge ohne Neuladen

#### Scenario: Leser ohne Modulrecht
- **WHEN** einem verbundenen Benutzer das Modul Verpflegung ausgeblendet ist
- **THEN** erhält er das Ereignis `verpflegung` nicht

### Requirement: Anzeige im Modul

Die Seite des Moduls SHALL die Zeitfenster nach Beginn geordnet zeigen, getrennt in
„laufend und anstehend“ und „vergangen“ (Ende vor dem aktuellen Zeitpunkt). Jedes
Zeitfenster zeigt Bezeichnung, Zeitraum, Gesamtbedarf mit Aufteilung, ausgegebene Menge,
Fehlmenge, Einstufung, die Sonderkost mit Bedarf, Ausgabe und Fehlmenge je belegter Kostform
sowie seine Ausgaben mit Zeitpunkt, Ort und Menge. Zahlen und Zeiten MUST in Monospace mit
tabellarischen Ziffern stehen.

#### Scenario: Leeres Modul
- **WHEN** ein Einsatz noch kein Zeitfenster hat
- **THEN** zeigt die Seite einen Leerzustand mit der Aktion „Zeitfenster anlegen“ (ohne Schreibrecht ohne Aktion)

#### Scenario: Vergangenes Zeitfenster mit Unterdeckung
- **WHEN** ein Zeitfenster mit Fehlmenge 20 vorbei ist
- **THEN** steht es in der Ansicht „vergangen“ weiterhin mit „Unterdeckung“ und Fehlmenge 20

### Requirement: Schwärzung

Beim Schwärzen eines Einsatzes MUST das System Ort und Bemerkung von Ausgaben leeren.
Bezeichnungen der Zeitfenster, Zeitpunkte, Bedarfe, Mengen, Sonderkost-Anzahlen und
Nachforderungsverweise MUST erhalten bleiben.

#### Scenario: Einsatz schwärzen
- **WHEN** ein Einsatz mit einer Ausgabe am Ort „Hof Familie Meyer, Deichstraße 4“ und der Bemerkung „für Frau Meyer glutenfrei“ geschwärzt wird
- **THEN** sind Ort und Bemerkung der Ausgabe leer
- **AND** Menge, Sonderkost und Zeitpunkt der Ausgabe sowie das Zeitfenster sind unverändert

### Requirement: Stab-Werkzeug S4

Das Sachgebiet S4 „Versorgung“ SHALL Verpflegung als Werkzeug führen, zusammen mit
Nachforderungen und Material. Fahrzeuge MUST dafür aus der S4-Zeile weichen (höchstens drei
Werkzeuge je Zeile).

#### Scenario: S4 im Stab
- **WHEN** eine Person die Stabsseite öffnet und das Modul Verpflegung zugänglich ist
- **THEN** führt die Zeile S4 die Werkzeuge Nachforderungen, Verpflegung und Material
