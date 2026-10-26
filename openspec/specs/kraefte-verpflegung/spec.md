# kraefte-verpflegung Specification

## Purpose
Die Führung und S4 sehen je Verpflegungszeitfenster, wie viele Essensportionen gebraucht und
ausgegeben wurden, und erkennen eine Unterdeckung, bevor jemand leer ausgeht. Nachschub
läuft dabei über die bestehende Nachforderung und bekommt keine zweite Wahrheit.

## Requirements

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
Die Oberfläche MUST ein Zeitfenster in seiner Karte bearbeiten, nicht in einem Dialog (LLH-1139):
„Bedarf bearbeiten“ macht die Karte zur Eingabe mit Bezeichnung, Zeitraum, Bedarf, Sonderkost,
Art und Stellen, Speichern MUST nur die geänderten Felder senden, und höchstens eine Karte der
Seite MUST zugleich bearbeitet werden (Spec `formularseiten`, „Eine offene Bearbeitung je
Ansicht“).

#### Scenario: Bedarf erhöhen
- **WHEN** der Bedarf Betreute eines Zeitfensters von 70 auf 90 geändert wird
- **THEN** beträgt der Gesamtbedarf 270 EP und die Fehlmenge steigt um 20

#### Scenario: Bedarf in der Karte bearbeiten
- **WHEN** eine Person mit Planungsrecht an der Karte „Mittag“ „Bedarf bearbeiten“ wählt, die Betreuten von 70 auf 90 ändert und speichert
- **THEN** öffnet sich kein Dialog, die Änderung geht als einziges Feld hinaus, und die Karte zeigt danach wieder Bedarf, Ausgaben und Aktionen

#### Scenario: Eine Karte zur Zeit
- **WHEN** die Karte „Mittag“ bearbeitet wird
- **THEN** steht „Bedarf bearbeiten“ an den übrigen Karten gesperrt mit „Erst „Mittag“ speichern oder abbrechen“

#### Scenario: Löschen mit Ausgaben
- **WHEN** ein Zeitfenster mit mindestens einer gültigen Ausgabe gelöscht werden soll
- **THEN** antwortet das System mit 422 und löscht nichts

#### Scenario: Zeitfenster eines anderen Einsatzes
- **WHEN** ein Zeitfenster über einen fremden Einsatz geändert, gelöscht oder mit einer Ausgabe belegt werden soll
- **THEN** antwortet das System mit 404

### Requirement: Ausgabe erfassen

Das System SHALL je Zeitfenster Ausgaben führen. Eine Ausgabe trägt Zeitpunkt, Menge in EP,
optional eine Verpflegungsstelle, optional Ort, Sonderkost je Kostform, optional den Verweis auf
eine Nachforderung und optional eine Bemerkung. Ausgaben MUST append-only sein: Es gibt keine
Bearbeitung, eine falsche Ausgabe wird zurückgenommen. Das System MUST einen Zeitpunkt außerhalb
des Zeitfensters annehmen (Anlieferung vor Beginn). Die Oberfläche SHALL Ausgaben auf zwei Wegen
erfassen: durch Zählen in der Ausgabeansicht (Requirement „Ausgabe zählen“) und über das
Formular „Ausgabe nachtragen“ mit Menge, Empfänger (Requirement „Empfänger wählen“), Zeitpunkt,
Ort, Sonderkost, Nachforderung und Bemerkung. Gibt es im Einsatz Verpflegungsstellen, MUST die
Oberfläche die Stelle zur Wahl anbieten und das Feld Ort nur ohne gewählte Stelle zeigen, dann als
„Zuführungsziel“. Sichtbar MUST das Formular höchstens Menge, Empfänger, Stelle und Zeitpunkt
zeigen; Ort, Sonderkost, Nachforderung und Bemerkung liegen eingeklappt, und der Kopf des
eingeklappten Teils MUST jede gefüllte Angabe nennen. Nach einer gesendeten
Erfassung MUST die Oberfläche einen Hinweis mit „Rückgängig“
zeigen. Ein neuer Hinweis MUST den vorigen ersetzen.

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
- **WHEN** eine Person mit Verbindung eine Ausgabe über „Ausgabe nachtragen“ erfasst hat oder eine gezählte Sammlung in der geöffneten Ausgabeansicht gebucht wurde
- **THEN** zeigt die Seite einen Hinweis mit der Aktion „Rückgängig“, die genau diese Ausgabe zurücknimmt

#### Scenario: Nur der letzte Rückweg
- **WHEN** zwei Sammlungen nacheinander gebucht werden
- **THEN** steht nur ein Hinweis mit „Rückgängig“, und er gilt der zweiten Sammlung

#### Scenario: Nachtragen in der Vergangenheit
- **WHEN** eine Person über „Ausgabe nachtragen“ zum vergangenen Zeitfenster „Frühstück“ 40 EP mit Zeitpunkt 07:30 erfasst
- **THEN** ist die Ausgabe mit dem Zeitpunkt 07:30 gespeichert und zählt in die ausgegebene Menge von „Frühstück“

#### Scenario: Stelle statt Ort
- **WHEN** im Einsatz Verpflegungsstellen bestehen und eine Person im Dialog eine Stelle wählt
- **THEN** zeigt der Dialog kein Feld für den Ort, und die Ausgabe wird mit der Stelle und ohne Ort gesendet

#### Scenario: Zuführungsziel ohne Stelle
- **WHEN** im Einsatz Verpflegungsstellen bestehen und eine Person im Dialog keine Stelle wählt
- **THEN** bietet der Dialog das Feld „Zuführungsziel“ an, das als Ort der Ausgabe gespeichert wird

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
Änderung auch den vorherigen Gesamtbedarf). Trägt das Zeitfenster eine Verpflegungsart oder
Stellen, MUST der Eintrag beim Anlegen sie nennen und bei einer Änderung den neuen und den
vorherigen Wert. Der Zeitraum MUST in der Zeitzone der Organisation stehen, nicht in UTC.
Inbetriebnahme und Auflösung einer Verpflegungsstelle MUST einen System-Eintrag schreiben, der
Bezeichnung und Art der Stelle nennt. Anlegen, Ändern und Stornieren einer Stelle sowie das
Erfassen und Zurücknehmen einer Ausgabe MUST keinen ETB-Eintrag schreiben.

#### Scenario: Bedarf geändert
- **WHEN** der Gesamtbedarf des Zeitfensters „Mittag“ von 250 auf 270 geändert wird
- **THEN** enthält das ETB einen System-Eintrag, der „Mittag“, den Zeitraum, 270 EP und den vorherigen Wert 250 nennt

#### Scenario: Zeitraum in Ortszeit
- **WHEN** die Organisation die Zeitzone Europe/Berlin führt und ein Zeitfenster am 24.09. von 10:00 bis 11:30 UTC angelegt wird
- **THEN** nennt der ETB-Eintrag den Zeitraum 241200sep26–1330 (Darstellung taktisch, Spec `zeitdarstellung`, „Servertexte“)

#### Scenario: Ausgabe ohne ETB
- **WHEN** eine Ausgabe erfasst oder zurückgenommen wird
- **THEN** entsteht kein neuer ETB-Eintrag

#### Scenario: Zeitfenster an Stellen angelegt
- **WHEN** das Zeitfenster „Mittag“ mit der Art warm an den Stellen „Feldküche BR Sportplatz“ und „Ausgabe Turnhalle Nord“ angelegt wird
- **THEN** nennt der ETB-Eintrag „warm“ und beide Stellen

#### Scenario: Stellen eines Zeitfensters geändert
- **WHEN** einem Zeitfenster, das nur der Feldküche zugeordnet ist, zusätzlich die Turnhalle zugeordnet wird
- **THEN** nennt der ETB-Eintrag die Stellen jetzt und vorher

#### Scenario: Stelle anlegen ohne ETB
- **WHEN** eine Verpflegungsstelle angelegt, geändert oder storniert wird
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

Jede Änderung an Zeitfenstern, Ausgaben und Verpflegungsstellen MUST nach dem Commit ein
Live-Ereignis `verpflegung` an alle verbundenen Clients des Einsatzes auslösen, die das Modul
Verpflegung lesen dürfen. Die Nutzlast MUST nur Kennungen tragen. Ein zugehöriger ETB-Eintrag MUST
zusätzlich als ETB-Ereignis verteilt werden. Neue Zeitfenster anderer Personen MUST die
Liste nicht unter dem Cursor verschieben, sondern als Sammelhinweis erscheinen. Die Ereignisse
`einheit` und `abschnitt` MUST zusätzlich alle verbundenen Clients erreichen, die das Modul
Verpflegung lesen dürfen, weil die Empfängerliste Einheiten und Abschnitte zeigt; der Client
MUST darauf die Verpflegung neu laden. Das Ereignis `personal` MUST Leser der Verpflegung nicht
deswegen erreichen.

#### Scenario: Zweiter Client sieht die Ausgabe
- **WHEN** Client A eine Ausgabe erfasst, während Client B die Verpflegungsseite desselben Einsatzes geöffnet hat
- **THEN** zeigt Client B die neue ausgegebene Menge ohne Neuladen

#### Scenario: Leser ohne Modulrecht
- **WHEN** einem verbundenen Benutzer das Modul Verpflegung ausgeblendet ist
- **THEN** erhält er das Ereignis `verpflegung` nicht

#### Scenario: Ereignis bei einer Stelle
- **WHEN** eine Verpflegungsstelle angelegt, geändert, im Status gewechselt oder storniert wird
- **THEN** löst das System nach dem Commit ein Ereignis `verpflegung` aus, dessen Nutzlast nur Kennungen trägt

#### Scenario: Einheit geändert, Leser nur der Verpflegung
- **WHEN** eine Einheit gebildet, umgehängt oder aufgelöst wird und ein verbundener Benutzer nur die Module Verpflegung, nicht aber Einheiten oder Lagekarte lesen darf
- **THEN** erhält er das Ereignis `einheit` und lädt die Verpflegung neu

#### Scenario: Personal geändert, Leser nur der Verpflegung
- **WHEN** die Position einer disponierten Person geändert wird und ein verbundener Benutzer nur das Modul Verpflegung lesen darf
- **THEN** erhält er das Ereignis `personal` nicht

#### Scenario: Zweiter Client sieht die neue Stelle
- **WHEN** Client A eine Verpflegungsstelle anlegt oder auflöst, während Client B die Ansicht „Stellen“ desselben Einsatzes geöffnet hat
- **THEN** zeigt Client B die Stelle bzw. ihren neuen Status ohne Neuladen

### Requirement: Anzeige im Modul

Die Seite des Moduls SHALL die Zeitfenster nach Beginn geordnet zeigen, getrennt in
„laufend und anstehend“ und „vergangen“ (Ende vor dem aktuellen Zeitpunkt). Jedes
Zeitfenster zeigt Bezeichnung, Verpflegungsart (wenn gesetzt), Zeitraum, Gesamtbedarf mit
Aufteilung, ausgegebene Menge, Fehlmenge, Einstufung, die Sonderkost mit Bedarf, Ausgabe und
Fehlmenge je belegter Kostform sowie seine Ausgaben mit Zeitpunkt, Empfänger, Stelle oder Ort und
Menge. Gibt es im Einsatz Einheiten, MUST jedes Zeitfenster eine eingeklappte Aufstellung
„Einheiten“ tragen, deren Kopf die Zahl der noch nicht verpflegten, der ohne Eintreffen und der
verpflegten Einheiten nennt und die aufgeklappt die Listen aus Requirement „Noch nicht
verpflegt“ zeigt. Ist
die Aufstellung je Stelle nicht leer, MUST das Zeitfenster die ausgegebene Menge je Stelle zeigen,
mit „aufgelöst“ bzw. „nicht zugeordnet“ an den betroffenen Stellen und „ohne Stelle“ zuletzt.
Zahlen und Zeiten MUST in Monospace mit tabellarischen Ziffern stehen. Mit Schreibrecht MUST ein laufendes oder anstehendes Zeitfenster
den Sprung „Ausgabe öffnen“ in seine Ausgabeansicht tragen. Jedes Zeitfenster MUST mit
Schreibrecht die Aktion „Ausgabe nachtragen“ tragen, auch ein vergangenes. Ein vergangenes
Zeitfenster MUST keinen Sprung „Ausgabe öffnen“ tragen.

#### Scenario: Leeres Modul
- **WHEN** ein Einsatz noch kein Zeitfenster hat
- **THEN** zeigt die Seite einen Leerzustand mit der Aktion „Zeitfenster anlegen“ (ohne Schreibrecht ohne Aktion)

#### Scenario: Vergangenes Zeitfenster mit Unterdeckung
- **WHEN** ein Zeitfenster mit Fehlmenge 20 vorbei ist
- **THEN** steht es in der Ansicht „vergangen“ weiterhin mit „Unterdeckung“ und Fehlmenge 20

#### Scenario: Sprung in die Ausgabe
- **WHEN** eine Person mit Schreibrecht am laufenden Zeitfenster „Mittag“ „Ausgabe öffnen“ wählt
- **THEN** zeigt die Oberfläche die Ausgabeansicht von „Mittag“, am Verpflegungsgerät unter dessen eigener Adresse

#### Scenario: Vergangenes Zeitfenster nur nachtragen
- **WHEN** eine Person mit Schreibrecht die Ansicht „vergangen“ öffnet
- **THEN** trägt jedes Zeitfenster dort „Ausgabe nachtragen“ und keinen Sprung „Ausgabe öffnen“

#### Scenario: Ohne Schreibrecht kein Sprung
- **WHEN** eine Person ohne Schreibrecht die Seite des Moduls öffnet
- **THEN** trägt kein Zeitfenster „Ausgabe öffnen“ oder „Ausgabe nachtragen“

#### Scenario: Ausgegeben je Stelle
- **WHEN** das Zeitfenster „Mittag“ an der Feldküche 100 EP und an der Turnhalle 80 EP ausgegeben hat
- **THEN** zeigt seine Karte beide Stellen mit ihrer Menge und darüber wie bisher die Fehlmenge des Zeitfensters

#### Scenario: Bestand ohne Stelle
- **WHEN** ein Zeitfenster keiner Stelle zugeordnet ist und keine Ausgabe an einer Stelle hat
- **THEN** zeigt seine Karte keine Aufstellung je Stelle und die Ausgaben mit ihrem Ort wie bisher

### Requirement: Schwärzung

Beim Schwärzen eines Einsatzes MUST das System Ort und Bemerkung von Ausgaben und den Standort
von Verpflegungsstellen leeren. Bezeichnungen der Zeitfenster und der Verpflegungsstellen, Art,
Status und Koordinate der Stellen, die Zuordnungen, Zeitpunkte, Bedarfe, Mengen,
Sonderkost-Anzahlen, Stellen- und Nachforderungsverweise sowie die Verweise auf Empfänger
(Einheit, Abschnitt) MUST erhalten bleiben.

#### Scenario: Einsatz schwärzen
- **WHEN** ein Einsatz mit einer Ausgabe am Ort „Hof Familie Meyer, Deichstraße 4“ und der Bemerkung „für Frau Meyer glutenfrei“ geschwärzt wird
- **THEN** sind Ort und Bemerkung der Ausgabe leer
- **AND** Menge, Sonderkost und Zeitpunkt der Ausgabe sowie das Zeitfenster sind unverändert

#### Scenario: Stelle schwärzen
- **WHEN** ein Einsatz mit der Stelle „Feldküche BR Sportplatz“ am Standort „Am Sportplatz 2“ und einer Ausgabe an ihr geschwärzt wird
- **THEN** ist der Standort leer
- **AND** Bezeichnung, Art, Status und Koordinate der Stelle, ihre Zuordnungen und der Verweis der Ausgabe auf sie sind unverändert

#### Scenario: Empfänger bleibt nach dem Schwärzen
- **WHEN** ein Einsatz mit einer Ausgabe an die Einheit „2. Gruppe“ geschwärzt wird
- **THEN** verweist die Ausgabe weiter auf die Einheit

### Requirement: Stab-Werkzeug S4

Das Sachgebiet S4 „Versorgung“ SHALL Verpflegung als Werkzeug führen, zusammen mit
Nachforderungen und Material. Fahrzeuge MUST NOT zu den Werkzeugen von S4 gehören: S4 führt, was
die Versorgung trägt, nicht die Kräfte. Eine Grenze für die Zahl der Werkzeuge je Sachgebiet gibt es
nicht (Spec `stab-uebersicht`).

#### Scenario: S4 im Stab
- **WHEN** eine Person die Stabsseite öffnet und das Modul Verpflegung zugänglich ist
- **THEN** führt die Kachel S4 die Werkzeuge Nachforderungen, Verpflegung und Material

### Requirement: Idempotente Erfassung einer Ausgabe

Eine Ausgabe SHALL optional einen Idempotenzschlüssel `client_id` tragen (höchstens 64 Zeichen,
leer zählt als fehlend). Je Einsatz MUST eine `client_id` höchstens eine Ausgabe bezeichnen. Ist
die `client_id` schon gespeichert, MUST das System diese Ausgabe mit dem aktuellen Zeitfenster
zurückliefern (201), ohne zweite Ausgabe und ohne weiteres Live-Ereignis. Ausgaben ohne
`client_id` MUST sich wie bisher verhalten.

#### Scenario: Wiederholte Ausgabe
- **WHEN** eine Ausgabe „120 EP“ mit `client_id` „v1“ zum Zeitfenster „Mittag“ gespeichert ist und dieselbe Ausgabe mit „v1“ erneut eintrifft
- **THEN** antwortet das System mit 201 und derselben Ausgabekennung
- **AND** das Zeitfenster hat genau eine Ausgabe mit „v1“, und die ausgegebene Menge steigt nicht

#### Scenario: Kein zweites Live-Ereignis beim Replay
- **WHEN** eine schon gespeicherte Ausgabe mit ihrer `client_id` erneut eintrifft
- **THEN** löst das System kein Live-Ereignis `verpflegung` aus

#### Scenario: Schlüssel eines anderen Zeitfensters
- **WHEN** zu `client_id` „v2“ eine Ausgabe am Zeitfenster „Mittag“ gespeichert ist und eine Ausgabe mit „v2“ am Zeitfenster „Abend“ eintrifft
- **THEN** antwortet das System mit 422 und speichert nichts

#### Scenario: Schlüssel eines anderen Einsatzes
- **WHEN** in Einsatz 1 eine Ausgabe mit `client_id` „v3“ gespeichert ist und in Einsatz 2 eine Ausgabe mit „v3“ eintrifft
- **THEN** speichert das System in Einsatz 2 eine neue Ausgabe und gibt keine Daten aus Einsatz 1 zurück

#### Scenario: Zu langer Schlüssel
- **WHEN** eine Ausgabe mit einer `client_id` von mehr als 64 Zeichen eintrifft
- **THEN** antwortet das System mit 400 und speichert nichts

### Requirement: Replay vor der Zustandsprüfung

Die Suche nach einer gespeicherten Ausgabe zur `client_id` MUST nach den Prüfungen auf
Schreibrecht und Modulzugang laufen, aber vor der Prüfung auf einen aktiven Einsatz und vor der
Prüfung der Verpflegungsstelle. Ein Replay MUST die gespeicherte Ausgabe auch dann liefern, wenn
sie inzwischen zurückgenommen oder ihre Stelle inzwischen aufgelöst ist. Eine neue Ausgabe an
einem abgeschlossenen Einsatz MUST weiter mit 409 abgelehnt werden.

#### Scenario: Replay nach Einsatzende
- **WHEN** eine Ausgabe mit `client_id` „v4“ gespeichert ist, der Einsatz danach abgeschlossen wird und dieselbe Ausgabe erneut eintrifft
- **THEN** antwortet das System mit 201 und der bestehenden Ausgabe, nicht mit 409

#### Scenario: Neue Ausgabe nach Einsatzende
- **WHEN** an einem abgeschlossenen Einsatz eine Ausgabe mit einer unbekannten `client_id` eintrifft
- **THEN** antwortet das System mit 409 und speichert nichts

#### Scenario: Replay einer zurückgenommenen Ausgabe
- **WHEN** eine Ausgabe mit `client_id` „v5“ gespeichert und danach zurückgenommen ist und dieselbe Ausgabe erneut eintrifft
- **THEN** antwortet das System mit 201 und der zurückgenommenen Ausgabe
- **AND** es entsteht keine neue Ausgabe, und die ausgegebene Menge bleibt ohne sie

#### Scenario: Beobachter ohne Schreibrecht
- **WHEN** ein Beobachter eine Ausgabe mit einer schon gespeicherten `client_id` sendet
- **THEN** antwortet das System mit 403 und gibt die Ausgabe nicht heraus

#### Scenario: Replay nach dem Auflösen der Stelle
- **WHEN** eine Ausgabe mit `client_id` „v6“ an der Stelle „Ausgabe Turnhalle Nord“ gespeichert ist, die Stelle danach aufgelöst wird und dieselbe Ausgabe mit einem Zeitpunkt nach der Auflösung erneut eintrifft
- **THEN** antwortet das System mit 201 und der bestehenden Ausgabe, nicht mit 409

### Requirement: Ausgabe ohne Verbindung vormerken

Die Oberfläche MUST eine Ausgabe, die mangels Verbindung nicht gesendet werden kann, auf dem
Gerät vormerken und bei wiederhergestellter Verbindung senden. Das gilt für eine nachgetragene
Ausgabe wie für eine gezählte Sammlung. Die vorgemerkte Ausgabe MUST den Zeitpunkt der
Erfassung tragen, wenn keiner eingetragen ist, und ihre Stelle und ihren Empfänger. Der Hinweis
nach dem Vormerken MUST ohne „Rückgängig“ erscheinen. Ein neuer Hinweis MUST den vorigen ersetzen. Eine Sammlung, die beim
Wechsel des Zeitfensters, beim Verlassen der Ansicht oder beim Verbergen der Seite vorgemerkt
wird, MUST ohne Hinweis vorgemerkt werden. Eine fachlich abgelehnte Ausgabe MUST mit Grund und
Inhalt sichtbar bleiben, bis sie verworfen oder erneut versucht wird.

#### Scenario: Ausgabe ohne Verbindung
- **WHEN** eine Person ohne Netzverbindung über „Ausgabe nachtragen“ 120 EP zu „Mittag“ erfasst
- **THEN** zeigt die Seite einen Hinweis, dass die Ausgabe vorgemerkt ist, und bietet kein „Rückgängig“ an
- **AND** nach wiederhergestellter Verbindung ist die Ausgabe genau einmal gespeichert, mit dem Zeitpunkt der Erfassung

#### Scenario: Sammlung ohne Verbindung
- **WHEN** eine Sammlung von 8 Portionen ohne Netzverbindung abgeschlossen wird
- **THEN** zeigt die Seite einen Hinweis, dass 8 EP vorgemerkt sind, ohne „Rückgängig“
- **AND** nach wiederhergestellter Verbindung ist genau eine Ausgabe über 8 EP gespeichert, mit dem Zeitpunkt des Abschlusses

#### Scenario: Vorgemerkte Ausgabe an eine Einheit
- **WHEN** eine Person ohne Netzverbindung 9 EP an die Einheit „2. Gruppe“ zählt und bucht
- **THEN** steht in der Warteschlange eine Ausgabe über 9 EP an die Einheit „2. Gruppe“
- **AND** nach wiederhergestellter Verbindung ist sie genau einmal mit dieser Einheit gespeichert

#### Scenario: Online bleibt Rückgängig
- **WHEN** eine Person mit Verbindung eine Ausgabe erfasst
- **THEN** zeigt die Seite wie bisher einen Hinweis mit der Aktion „Rückgängig“

#### Scenario: Vorgemerkte Ausgabe wird abgelehnt
- **WHEN** eine vorgemerkte Ausgabe beim Senden abgelehnt wird, weil ihr Zeitfenster inzwischen gelöscht ist
- **THEN** steht sie im Wiederherstellungsbereich als abgelehnte Verpflegungsausgabe mit der Bezeichnung des Zeitfensters, dem Grund und dem vollständigen Inhalt

### Requirement: Ausstehende Ausgaben außerhalb der Deckung

Eine auf diesem Gerät vorgemerkte Ausgabe MUST an ihrem Zeitfenster als „ausstehend“
gekennzeichnet erscheinen, solange der Server sie nicht bestätigt hat. Sie MUST bis dahin weder
in die ausgegebene Menge noch in Fehlmenge oder Einstufung zählen, und sie MUST keine Aktion
„Zurücknehmen“ anbieten.

#### Scenario: Ausstehend sichtbar, nicht gezählt
- **WHEN** zum Zeitfenster „Mittag“ (Bedarf 250, ausgegeben 100) offline eine Ausgabe von 120 EP vorgemerkt ist
- **THEN** zeigt die Karte die Ausgabe 120 EP als „ausstehend“ ohne „Zurücknehmen“
- **AND** sie zeigt weiter ausgegeben 100 und Fehlmenge 150

#### Scenario: Nach der Bestätigung gezählt
- **WHEN** die vorgemerkte Ausgabe von 120 EP gesendet und vom Server gespeichert ist
- **THEN** steht sie als gewöhnliche Ausgabe in der Liste, die Kennzeichnung „ausstehend“ entfällt, und die Karte zeigt ausgegeben 220 und Fehlmenge 30

### Requirement: Verpflegungsstelle

Das System SHALL je Einsatz Verpflegungsstellen führen. Eine Stelle trägt eine Bezeichnung, eine
Art (Feldküche, Ausgabestelle oder Zuführung), optional einen Standort als Freitext mit einer
Koordinate und optional einen Abschnitt desselben Einsatzes. Die getrimmte Bezeichnung MUST unter
den nicht stornierten Stellen eines Einsatzes eindeutig sein. Eine Koordinate MUST aus Breite und
Länge zusammen bestehen. Anlegen und Ändern einer Stelle MUST keinen ETB-Eintrag schreiben. Eine
Verpflegungsstelle MUST keinen Bestand und kein Material führen; sie ist kein Versorgungsposten.

#### Scenario: Stelle anlegen
- **WHEN** eine Person mit Schreibrecht die Stelle „Feldküche BR Sportplatz“ der Art Feldküche mit Standort „Am Sportplatz 2“ anlegt
- **THEN** entsteht die Stelle mit Status „geplant“, und das ETB erhält keinen neuen Eintrag

#### Scenario: Bezeichnung schon vergeben
- **WHEN** im selben Einsatz eine zweite nicht stornierte Stelle „Feldküche BR Sportplatz“ angelegt oder eine Stelle so umbenannt wird
- **THEN** antwortet das System mit 409 und ändert nichts

#### Scenario: Bezeichnung nach Storno wieder frei
- **WHEN** die Stelle „Zuführung Deich“ storniert ist und eine neue Stelle „Zuführung Deich“ angelegt wird
- **THEN** entsteht die neue Stelle

#### Scenario: Leere Bezeichnung oder unbekannte Art
- **WHEN** eine Stelle mit leerer Bezeichnung oder einer unbekannten Art angelegt wird
- **THEN** antwortet das System mit 400 und legt nichts an

#### Scenario: Halbe Koordinate
- **WHEN** eine Stelle mit Breite, aber ohne Länge gespeichert wird
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Abschnitt eines anderen Einsatzes
- **WHEN** eine Stelle mit einem Abschnitt eines anderen Einsatzes gespeichert wird
- **THEN** antwortet das System mit 404 und ändert nichts

### Requirement: Lebenszyklus einer Verpflegungsstelle

Eine Stelle SHALL die Status `geplant`, `aktiv` und `aufgeloest` durchlaufen: von `geplant` nach
`aktiv` oder direkt nach `aufgeloest`, von `aktiv` nach `aufgeloest`. `aufgeloest` MUST endgültig
sein, und das System MUST den Zeitpunkt der Auflösung speichern. Ein anderer Übergang MUST mit 422
abgelehnt werden. Inbetriebnahme und Auflösung MUST in derselben Transaktion einen System-Eintrag
im ETB schreiben. Eine Stelle MUST sich nur stornieren lassen, solange sie `geplant` ist und keine
Ausgabe, auch keine zurückgenommene, auf sie verweist; das Stornieren entfernt ihre Zuordnungen und
schreibt keinen ETB-Eintrag. Hängt an der Stelle eine laufende Gerätekopplung (wartend oder aktiv,
LLH-1048), MUST das Storno mit 409 und dem Grund „Gerät gekoppelt“ abgelehnt werden; die Stelle
MUST in ihrer Anzeige nennen, ob ein Gerät an ihr gekoppelt ist, ohne Kopplung und Bezeichnung. Ändern, Statuswechsel und Storno einer stornierten Stelle MUST mit 409
abgelehnt werden. Eine aufgelöste Stelle MUST änderbar bleiben.

#### Scenario: In Betrieb nehmen
- **WHEN** die geplante Stelle „Feldküche BR Sportplatz“ in Betrieb genommen wird
- **THEN** hat sie den Status „aktiv“, und das ETB enthält einen System-Eintrag, der sie als in Betrieb genommen nennt

#### Scenario: Auflösen
- **WHEN** die aktive Stelle „Ausgabe Turnhalle Nord“ aufgelöst wird
- **THEN** hat sie den Status „aufgelöst“ mit dem Zeitpunkt der Auflösung, und das ETB enthält einen System-Eintrag, der sie als aufgelöst nennt

#### Scenario: Aufgelöste Stelle wieder in Betrieb nehmen
- **WHEN** eine aufgelöste Stelle in Betrieb genommen werden soll
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Stornieren mit gekoppeltem Gerät
- **WHEN** eine geplante Stelle ohne Ausgabe storniert werden soll, an der ein Verpflegungsgerät gekoppelt ist, auch eines, das seinen Code noch nicht eingelöst hat
- **THEN** antwortet das System mit 409 „Gerät gekoppelt“ und storniert nichts
- **AND** nach dem Widerruf der Kopplung storniert es die Stelle

#### Scenario: Stornieren mit Ausgabe
- **WHEN** eine geplante Stelle storniert werden soll, an der eine Ausgabe gebucht ist
- **THEN** antwortet das System mit 422 und storniert nichts

#### Scenario: Aktive Stelle stornieren
- **WHEN** eine aktive Stelle storniert werden soll
- **THEN** antwortet das System mit 422 und storniert nichts

#### Scenario: Stornierte Stelle ändern
- **WHEN** eine stornierte Stelle geändert oder in Betrieb genommen werden soll
- **THEN** antwortet das System mit 409

#### Scenario: Stelle eines anderen Einsatzes
- **WHEN** eine Stelle über einen fremden Einsatz geändert, im Status gewechselt oder storniert werden soll
- **THEN** antwortet das System mit 404

### Requirement: Zuordnung von Zeitfenstern zu Stellen

Ein Zeitfenster SHALL einer oder mehreren Stellen desselben Einsatzes zugeordnet werden können,
beim Anlegen und beim Ändern. Ohne Zuordnung MUST das Zeitfenster einsatzweit gelten wie bisher.
Der Bedarf MUST am Zeitfenster bleiben; ein Bedarf je Stelle MUST es nicht geben. Beim Ändern
MUST eine übergebene Liste die Zuordnung ersetzen, eine leere Liste sie leeren und eine fehlende
Liste sie unverändert lassen. Eine Stelle eines anderen Einsatzes, eine stornierte Stelle oder
eine neu hinzukommende aufgelöste Stelle MUST mit 422 abgelehnt werden; eine schon zugeordnete
aufgelöste Stelle MUST zugeordnet bleiben dürfen. Das Löschen eines Zeitfensters MUST seine
Zuordnungen entfernen.

#### Scenario: Zeitfenster an zwei Stellen
- **WHEN** das Zeitfenster „Mittag“ mit Bedarf 200 den Stellen „Feldküche BR Sportplatz“ und „Ausgabe Turnhalle Nord“ zugeordnet wird
- **THEN** gilt es an beiden Stellen, und sein Gesamtbedarf bleibt 200

#### Scenario: Zuordnung leeren
- **WHEN** ein Zeitfenster mit einer leeren Stellenliste geändert wird
- **THEN** ist es keiner Stelle mehr zugeordnet und gilt einsatzweit

#### Scenario: Aufgelöste Stelle neu zuordnen
- **WHEN** ein Zeitfenster einer aufgelösten Stelle neu zugeordnet werden soll
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Unveränderte Zuordnung
- **WHEN** ein Zeitfenster mit derselben Menge von Stellen in anderer Reihenfolge geändert wird
- **THEN** ändert sich nichts, und es entsteht weder ein ETB-Eintrag noch ein Live-Ereignis

### Requirement: Ausgabe an einer Verpflegungsstelle

Eine Ausgabe SHALL optional auf eine Verpflegungsstelle desselben Einsatzes verweisen. Eine Stelle
eines anderen Einsatzes, eine unbekannte oder eine stornierte Stelle MUST mit 422 abgelehnt
werden. An einer aufgelösten Stelle MUST eine Ausgabe mit 409 abgelehnt werden, wenn ihr Zeitpunkt
nicht vor der Auflösung liegt; eine Ausgabe mit früherem Zeitpunkt MUST angenommen werden. Beide
Zeitpunkte MUST als Zeitpunkte verglichen werden, nicht als Text. Eine
geplante Stelle MUST Ausgaben annehmen. Eine Stelle, der das Zeitfenster nicht zugeordnet ist, MUST
die Ausgabe ebenfalls annehmen. Die Prüfung der Stelle MUST nach dem Replay über `client_id` und
nach der Prüfung auf einen aktiven Einsatz laufen. Ein an eine Verpflegungsstelle gebundenes Gerät
MUST jede Ausgabe an seiner Stelle buchen: ohne Angabe setzt der Server sie, eine andere Stelle
MUST 403 sein (LLH-1048).

#### Scenario: Gerät an der Feldküche bucht ohne Angabe
- **WHEN** das an die „Feldküche BR Sportplatz“ gebundene Gerät eine Ausgabe ohne Stelle erfasst
- **THEN** trägt die Ausgabe die Stelle „Feldküche BR Sportplatz“

#### Scenario: Ausgabe an der Feldküche
- **WHEN** zum Zeitfenster „Mittag“ eine Ausgabe von 100 EP an der Stelle „Feldküche BR Sportplatz“ erfasst wird
- **THEN** trägt die Ausgabe die Stelle und zählt in die ausgegebene Menge des Zeitfensters

#### Scenario: Aufgelöste Stelle
- **WHEN** eine Ausgabe mit dem Zeitpunkt der Erfassung an einer aufgelösten Stelle erfasst wird
- **THEN** antwortet das System mit 409 und legt nichts an

#### Scenario: Offline vor der Auflösung gebucht
- **WHEN** eine Ausgabe offline um 12:10 an der Stelle „Ausgabe Turnhalle Nord“ vorgemerkt wurde, die Stelle um 12:20 aufgelöst wird und die Ausgabe um 12:30 eintrifft
- **THEN** speichert das System die Ausgabe an dieser Stelle mit dem Zeitpunkt 12:10

#### Scenario: Stelle eines anderen Einsatzes
- **WHEN** eine Ausgabe auf eine Stelle eines anderen Einsatzes verweist
- **THEN** antwortet das System mit 422 und legt nichts an

#### Scenario: Stornierte Stelle
- **WHEN** eine Ausgabe auf eine stornierte Stelle verweist
- **THEN** antwortet das System mit 422 und legt nichts an

#### Scenario: Geplante Stelle
- **WHEN** an einer Stelle, die noch nicht in Betrieb genommen ist, eine Ausgabe erfasst wird
- **THEN** speichert das System die Ausgabe

#### Scenario: Stelle ohne Zuordnung zum Zeitfenster
- **WHEN** das Zeitfenster „Mittag“ nur der Feldküche zugeordnet ist und eine Ausgabe an der Stelle „Zuführung Deich“ erfasst wird
- **THEN** speichert das System die Ausgabe an der Stelle „Zuführung Deich“

### Requirement: Ausgegebene Menge je Stelle

Das System SHALL je Zeitfenster die ausgegebene Menge je Stelle liefern, gesamt und je Kostform,
aus derselben Rechnung wie die Deckung. Die Aufstellung MUST jede zugeordnete Stelle enthalten,
auch mit 0, jede weitere Stelle mit Ausgaben und einen Eintrag „ohne Stelle“, wenn es Ausgaben
ohne Stelle gibt. Ihre Summe MUST die ausgegebene Menge des Zeitfensters sein. Hat ein Zeitfenster
keine Zuordnung und keine Ausgabe an einer Stelle, MUST die Aufstellung leer sein. Eine Fehlmenge
oder Einstufung je Stelle MUST es nicht geben; Fehlmenge und Einstufung bleiben am Zeitfenster.
Zurückgenommene Ausgaben MUST nicht zählen. Ein an eine Verpflegungsstelle gebundenes Gerät MUST
nur den Eintrag seiner Stelle erhalten, die ausgegebene Menge des Zeitfensters aber unverändert;
was anderswo an Einheiten ausgegeben wurde, erhält es als Summe je Einheit
(`verpflegt_anderswo`, Spec `funktionsansichten`, „Verpflegungsgerät an einer
Verpflegungsstelle“, LLH-1048). Für jede andere Sitzung MUST diese Summe leer sein.

#### Scenario: Zwei Stellen
- **WHEN** das Zeitfenster „Mittag“ mit Bedarf 200 der Feldküche und der Turnhalle zugeordnet ist und dort 100 und 80 EP ausgegeben sind
- **THEN** liefert es je Stelle 100 und 80 EP, gesamt ausgegeben 180 und die Fehlmenge 20

#### Scenario: Ausgaben ohne Stelle
- **WHEN** zu einem Zeitfenster, das der Feldküche zugeordnet ist, 100 EP an der Feldküche und 30 EP ohne Stelle ausgegeben sind
- **THEN** enthält die Aufstellung die Feldküche mit 100 und „ohne Stelle“ mit 30

#### Scenario: Zeitfenster ohne Zuordnung
- **WHEN** ein Zeitfenster keiner Stelle zugeordnet ist und alle Ausgaben ohne Stelle erfasst sind
- **THEN** ist die Aufstellung je Stelle leer, und das Zeitfenster zeigt wie bisher nur Gesamtwerte

### Requirement: Verpflegungsart eines Zeitfensters

Ein Zeitfenster SHALL optional eine Verpflegungsart tragen: warm, kalt oder Getränke. Sie MUST nur
der Anzeige dienen; Bedarf, Deckung und Einstufung MUST für alle Arten gleich gerechnet werden.
Ein Zeitfenster ohne Art MUST sich wie bisher verhalten.

#### Scenario: Getränke
- **WHEN** das Zeitfenster „Getränke“ mit der Art Getränke und Bedarf 120 angelegt wird und 100 EP ausgegeben sind
- **THEN** zeigt es die Art „Getränke“ und wie jedes Zeitfenster die Fehlmenge 20 mit Einstufung

#### Scenario: Unbekannte Art
- **WHEN** ein Zeitfenster mit einer unbekannten Verpflegungsart angelegt wird
- **THEN** antwortet das System mit 400 und legt nichts an

### Requirement: Empfänger einer Ausgabe

Eine Ausgabe SHALL optional genau einen Empfänger tragen: eine Einheit desselben Einsatzes
(Abholung) oder einen Abschnitt desselben Einsatzes (Zuführung). Personen MUST NOT Empfänger sein.
Eine Ausgabe MUST vom Empfänger nur die Kennung tragen. Nennt eine Ausgabe Einheit und Abschnitt
zugleich, MUST das System mit 422 antworten. Eine Einheit oder ein Abschnitt eines anderen
Einsatzes oder eine unbekannte Kennung MUST mit 404 abgelehnt werden. Ist die Einheit aufgelöst,
MUST das System die Ausgabe mit 409 ablehnen, wenn ihr Zeitpunkt nicht vor der Auflösung liegt;
eine Ausgabe mit früherem Zeitpunkt MUST angenommen werden. Die Prüfung des Empfängers MUST nach
dem Replay über `client_id` und nach der Prüfung auf einen aktiven Einsatz laufen; ein Replay
MUST die gespeicherte Ausgabe ohne diese Prüfung liefern. Eine Ausgabe mit Empfänger MUST wie
jede Ausgabe keinen ETB-Eintrag schreiben. Eine Ausgabe ohne Empfänger MUST weiter angenommen
werden; so bucht die Ausgabeansicht eine gezählte Sammlung (Requirement „Ausgabe zählen“) und
das Formular „Ausgabe nachtragen“ eine Ausgabe, solange sie keinen Empfänger nennen. Eine als
eine Ausgabe gebuchte Sammlung trägt damit höchstens einen Empfänger für alle ihre Portionen.

#### Scenario: Abholung durch eine Einheit
- **WHEN** zum Zeitfenster „Mittag“ eine Ausgabe von 9 EP an die Einheit „2. Gruppe“ erfasst wird
- **THEN** trägt die Ausgabe die Kennung der Einheit und zählt in die ausgegebene Menge des Zeitfensters
- **AND** das ETB erhält keinen neuen Eintrag

#### Scenario: Zuführung an einen Abschnitt
- **WHEN** zum Zeitfenster „Mittag“ eine Ausgabe von 40 EP an den Abschnitt „Deich“ erfasst wird
- **THEN** trägt die Ausgabe die Kennung des Abschnitts

#### Scenario: Zwei Empfänger
- **WHEN** eine Ausgabe die Einheit „2. Gruppe“ und den Abschnitt „Deich“ zugleich nennt
- **THEN** antwortet das System mit 422 und legt nichts an

#### Scenario: Menge und zwei Empfänger fehlerhaft
- **WHEN** eine Ausgabe mit Menge 0 die Einheit „2. Gruppe“ und den Abschnitt „Deich“ zugleich nennt
- **THEN** antwortet das System mit 400

#### Scenario: Einheit eines anderen Einsatzes
- **WHEN** eine Ausgabe eine Einheit eines anderen Einsatzes oder eine unbekannte Einheit nennt
- **THEN** antwortet das System mit 404 und legt nichts an

#### Scenario: Abschnitt eines anderen Einsatzes
- **WHEN** eine Ausgabe einen Abschnitt eines anderen Einsatzes oder einen unbekannten Abschnitt nennt
- **THEN** antwortet das System mit 404 und legt nichts an

#### Scenario: Aufgelöste Einheit
- **WHEN** die Einheit „2. Gruppe“ um 12:20 aufgelöst wurde und eine Ausgabe an sie mit dem Zeitpunkt der Erfassung um 12:30 erfasst wird
- **THEN** antwortet das System mit 409 und legt nichts an

#### Scenario: Vor der Auflösung offline gebucht
- **WHEN** eine Ausgabe an die Einheit „2. Gruppe“ um 12:10 offline vorgemerkt wurde, die Einheit um 12:20 aufgelöst wird und die Ausgabe um 12:30 eintrifft
- **THEN** speichert das System die Ausgabe an die Einheit mit dem Zeitpunkt 12:10

#### Scenario: Replay nach dem Auflösen
- **WHEN** eine Ausgabe an die Einheit „2. Gruppe“ mit `client_id` „v6“ gespeichert ist, die Einheit danach aufgelöst wird und dieselbe Ausgabe erneut eintrifft
- **THEN** antwortet das System mit 201 und der gespeicherten Ausgabe

#### Scenario: Abschnitt gelöscht
- **WHEN** der Abschnitt „Deich“ gelöscht wird, an den eine Ausgabe ging
- **THEN** bleibt die Ausgabe mit Menge und Zeitpunkt bestehen und zählt weiter in die ausgegebene Menge, nur ohne Empfänger

#### Scenario: Gezählte Sammlung ohne Empfänger
- **WHEN** in der Ausgabeansicht von „Mittag“ eine Sammlung von 20 Portionen ohne Empfänger gebucht wird
- **THEN** ist genau eine Ausgabe über 20 EP ohne Empfänger gespeichert und zählt in die ausgegebene Menge des Zeitfensters

### Requirement: Empfängerliste der Verpflegung

Die Antwort des Verpflegungsmoduls SHALL eine Empfängerliste enthalten: alle nicht aufgelösten
Einheiten des Einsatzes mit Name, Funkrufname, Über-Einheit, Abschnitt, eigener und kumulierter
Ist-Stärke und dem Zeitpunkt des Eintreffens, dazu die aufgelösten Einheiten, auf die eine Ausgabe
verweist, und alle Abschnitte mit Name und Über-Abschnitt. Die Stärken MUST aus derselben Rechnung
stammen wie in der Einheitenliste. Das Eintreffen MUST das nicht gestrichene Eintreffen der
jüngsten Einsatzperiode sein und fehlen, wenn es keins gibt. Die Liste MUST NOT Einheitsführer,
Verbindungen, Bemerkung, Mitglieder, Fahrzeuge oder Material enthalten.
Jeder, der die Verpflegung lesen darf, MUST die Liste erhalten, auch ohne Zugriff auf das Modul
Einheiten; Einheiten- und Abschnittsnamen, Gliederung, Stärke und Eintreffen sind
Lagebezeichnungen ohne Personenbezug und hier eine bewusste Ausnahme von der Regel, dass das
Verpflegungsmodul nichts aus anderen Modulen hineinzieht.

#### Scenario: Liste mit Gliederung und Stärke
- **WHEN** der Einsatz den Zug „Florian 1“ (eigene Stärke 1/0/1) mit den Gruppen „1. Gruppe“ (0/1/8) und „2. Gruppe“ (0/1/8) führt und die Verpflegung abgerufen wird
- **THEN** enthält die Empfängerliste alle drei Einheiten mit Über-Einheit, „Florian 1“ mit eigener Stärke 1/0/1 und kumulierter Stärke 1/2/17

#### Scenario: Ohne Eintreffen
- **WHEN** eine Einheit kein nicht gestrichenes Eintreffen in ihrer Zeitachse hat
- **THEN** trägt sie in der Empfängerliste keinen Zeitpunkt des Eintreffens

#### Scenario: Abgelöste Einheit bleibt
- **WHEN** die Schicht der Einheit „1. Gruppe“ vollzogen ist und ihre Einsatzperiode damit endete
- **THEN** steht sie weiter in der Empfängerliste mit dem Eintreffen dieser Periode

#### Scenario: Keine Personenangaben
- **WHEN** eine Einheit mit Einheitsführer, Telefonverbindung und Personal in der Empfängerliste steht
- **THEN** enthält die Antwort weder den Namen des Einheitsführers noch die Verbindung noch Namen von Mitgliedern

#### Scenario: Leser ohne Modul Einheiten
- **WHEN** eine Person die Verpflegung lesen darf, das Modul Einheiten für sie aber ausgeblendet ist
- **THEN** erhält sie die Empfängerliste mit den Namen der Einheiten
- **AND** die Einheitenliste des Einsatzes beantwortet das System ihr weiter mit 403

#### Scenario: Aufgelöste Einheit mit Ausgabe
- **WHEN** die Einheit „2. Gruppe“ eine Ausgabe bekommen hat und danach aufgelöst wurde
- **THEN** steht sie in der Empfängerliste mit ihrem Namen und dem Zeitpunkt der Auflösung

### Requirement: Stellen im Modul

Die Seite des Moduls SHALL neben den Ansichten „laufend und anstehend“ und „vergangen“ eine
Ansicht „Stellen“ in derselben Umschaltleiste führen. Sie MUST je Stelle Bezeichnung, Art,
Standort, Status als Wort mit Rollenfarbe und das laufende Zeitfenster der Stelle mit der dort
ausgegebenen Menge zeigen; aufgelöste Stellen stehen zuletzt. Mit Schreibrecht und dem Recht zu
planen MUST sie „Stelle anlegen“, „In Betrieb nehmen“, „Auflösen“ mit Rückfrage, „Bearbeiten“ und,
wo zulässig, „Stornieren“ mit Rückfrage anbieten. Ohne Schreibrecht MUST „Stelle anlegen“ gesperrt
mit Grund stehen und die Zeilenaktionen MUST fehlen (wie unter „Rechte und Modulsichtbarkeit“).
Der Dialog zum Anlegen MUST mit Bezeichnung, Art und Standort auskommen. Das Verpflegungsgerät
MUST die Stellen sehen, aber keine dieser Aktionen erhalten, auch kein gesperrtes „Stelle anlegen“.
Ist an einer geplanten Stelle ohne Ausgabe ein Gerät gekoppelt, MUST „Stornieren“ gesperrt mit dem
Grund „Gerät gekoppelt“ stehen (LLH-1048).

#### Scenario: Stellen ansehen
- **WHEN** eine Person die Ansicht „Stellen“ wählt, während die Feldküche aktiv ist und im laufenden Zeitfenster „Mittag“ 100 EP ausgegeben hat
- **THEN** zeigt die Zeile der Feldküche Art, Standort, „aktiv“ und „Mittag“ mit 100 EP

#### Scenario: Stelle in Betrieb nehmen
- **WHEN** eine Person mit Schreibrecht bei der geplanten Stelle „Zuführung Deich“ „In Betrieb nehmen“ wählt
- **THEN** zeigt die Zeile „aktiv“ ohne Neuladen

#### Scenario: Leere Ansicht
- **WHEN** ein Einsatz keine Verpflegungsstelle hat und eine Person mit Schreibrecht die Ansicht „Stellen“ wählt
- **THEN** zeigt die Seite einen Leerzustand mit der Aktion „Stelle anlegen“

#### Scenario: Beobachter sieht die Stellen
- **WHEN** eine Person ohne Schreibrecht die Ansicht „Stellen“ wählt
- **THEN** zeigt die Seite die Stellen ohne Zeilenaktionen und „Stelle anlegen“ gesperrt mit Grund

#### Scenario: Stornieren gesperrt bei gekoppeltem Gerät
- **WHEN** eine Person mit Schreibrecht das Menü der geplanten Stelle „Zuführung Deich“ öffnet, an der ein Gerät gekoppelt ist
- **THEN** steht dort „Stornieren … (Gerät gekoppelt)“ gesperrt

#### Scenario: Gerät sieht die Stellen
- **WHEN** das Verpflegungsgerät die Ansicht „Stellen“ öffnet
- **THEN** zeigt sie die Stellen ohne „Stelle anlegen“, „In Betrieb nehmen“, „Auflösen“, „Bearbeiten“ und „Stornieren“

### Requirement: Ausgabeansicht eines Zeitfensters

Die Oberfläche SHALL je Zeitfenster eine Ausgabeansicht als eigene Adresse führen, an der
Stabsoberfläche unter `/einsaetze/{id}/verpflegung/{zeitfensterId}/ausgabe` und am
Verpflegungsgerät unter `/geraet/{id}/verpflegung/{zeitfensterId}/ausgabe`. Die Ansicht MUST
Bedarf, ausgegebene Menge und Fehlmenge des Zeitfensters groß als Zahl und als Balken zeigen,
dazu die Einstufung aus Wort und Rollenfarbe. Die Menge der offenen Sammlung und die auf dem
Gerät vorgemerkten Ausgaben MUST sie getrennt davon zeigen, als „Sammlung“ bzw. „ausstehend“.
Beide MUST NOT in Fehlmenge oder Einstufung zählen. Die Ansicht MUST die zehn jüngsten Ausgaben
des Zeitfensters mit Zeitpunkt, Menge und Sonderkost zeigen. Gültige Ausgaben tragen dort
„Zurücknehmen“, ausstehende nicht. Die Taste „+1“ MUST in jeder Dichtestufe mindestens 72 px
hoch sein und am unteren Rand der Ansicht stehen. Alle übrigen Zähltasten MUST mindestens die
Steuerhöhe der Stufe erreichen. Ein Tipp, eine Ablehnung oder ein Wechsel der Verbindung MUST
NOT eine Zähltaste verschieben. Ohne Schreibrecht MUST die Ansicht den Hinweis auf den Grund
zeigen, die Zähltasten gesperrt stehen lassen und „Zurücknehmen“ weglassen (Requirement „Rechte
und Modulsichtbarkeit“). Die Startseite des Verpflegungsgeräts MUST die Liste der Zeitfenster
bleiben.

Gibt es im Einsatz Verpflegungsstellen, MUST die Ansicht im Kopf eine Stellenwahl führen:
„ohne Stelle“, die dem Zeitfenster zugeordneten Stellen zuerst, dann die übrigen, ohne
aufgelöste. Daneben MUST sie die an der gewählten Stelle im Zeitfenster ausgegebene Menge zeigen.
Beim Öffnen MUST die Ansicht vorwählen, in dieser Reihenfolge: die Stelle aus der Adresse
(`?stelle=`, der Sprung „Ausgabe öffnen“ aus der Zeile einer Stelle an der Karte), die in diesem
Browser für den Einsatz gemerkte Wahl, die einzige zugeordnete Stelle, sonst „ohne Stelle“; eine
nicht wählbare Stelle wird dabei übersprungen. Die Vorwahl gilt beim Öffnen: Eine Änderung der
Zuordnung bei offener Ansicht MUST NOT die Wahl ändern. Die Wahl ändert sich nur durch die Person
oder, wenn die gewählte Stelle aufgelöst wird, auf „ohne Stelle“. Die Stabsoberfläche MUST die
Wahl je Einsatz im Browser merken (bei jedem Ende der Anmeldung geräumt); das
Verpflegungsgerät MUST nichts merken. Ohne Stellen im Einsatz MUST die Stellenwahl fehlen. Ein
an eine Verpflegungsstelle gebundenes Gerät (LLH-1048) MUST keine Stellenwahl führen, weder in
der Ausgabeansicht noch im Nachtrag: dort MUST die eigene Stelle fest als Text stehen, mit der an
ihr ausgegebenen Menge, auch in einem Zeitfenster ohne Zuordnung, und jede Ausgabe MUST sie tragen;
eine Stelle aus der Adresse MUST es übergehen.

#### Scenario: Ansicht öffnen
- **WHEN** eine Person mit Schreibrecht am laufenden Zeitfenster „Mittag“ (Bedarf 150, ausgegeben 80) „Ausgabe öffnen“ wählt
- **THEN** öffnet die Ausgabeansicht unter der Adresse des Zeitfensters und zeigt Bedarf 150, ausgegeben 80 und fehlt 70

#### Scenario: Ausstehend getrennt
- **WHEN** zum Zeitfenster „Mittag“ (Bedarf 150, ausgegeben 80) auf diesem Gerät 12 EP vorgemerkt sind
- **THEN** zeigt die Ausgabeansicht „+ 12 ausstehend“ getrennt von der ausgegebenen Menge
- **AND** sie zeigt weiter ausgegeben 80 und fehlt 70

#### Scenario: Unbekanntes Zeitfenster
- **WHEN** die Adresse ein Zeitfenster nennt, das es im Einsatz nicht oder nicht mehr gibt
- **THEN** zeigt die Ansicht, dass es dieses Zeitfenster nicht gibt, mit einem Weg zur Verpflegung, und keine Zähltasten

#### Scenario: Beobachter öffnet die Adresse
- **WHEN** eine Person ohne Schreibrecht die Ausgabeansicht eines Zeitfensters öffnet
- **THEN** sieht sie Bedarf, Ausgaben und Fehlmenge und den Hinweis auf das fehlende Schreibrecht
- **AND** die Zähltasten stehen gesperrt, und keine Ausgabe trägt „Zurücknehmen“

#### Scenario: Große Taste in jeder Stufe
- **WHEN** die Ausgabeansicht in der Dichtestufe `kompakt` gezeigt wird
- **THEN** ist die Taste „+1“ mindestens 72 px hoch und steht am unteren Rand der Ansicht

#### Scenario: Erster Tipp verschiebt nichts
- **WHEN** in der Ausgabeansicht eines Zeitfensters mit belegter Sonderkost der erste Tipp eine Sammlung beginnt
- **THEN** stehen alle Zähltasten danach an derselben Stelle wie davor

#### Scenario: Gerät behält seine Startseite
- **WHEN** das Verpflegungsgerät nach dem Koppeln oder Neuladen seine Startseite öffnet
- **THEN** zeigt es die Liste der Zeitfenster, nicht die Ausgabeansicht eines Zeitfensters

#### Scenario: Ausgabe an einer Stelle öffnen
- **WHEN** „Mittag“ der Feldküche (100 EP ausgegeben) und der Turnhalle zugeordnet ist und eine Person an der Karte in der Zeile der Feldküche „Ausgabe öffnen“ wählt
- **THEN** öffnet die Ausgabeansicht mit der Feldküche gewählt und zeigt an ihr 100 EP

#### Scenario: Einzige zugeordnete Stelle
- **WHEN** „Mittag“ nur der Feldküche zugeordnet ist und eine Person die Ausgabeansicht ohne Stelle in der Adresse und ohne gemerkte Wahl öffnet
- **THEN** ist die Feldküche gewählt

#### Scenario: Zuordnung ändert sich beim Zählen
- **WHEN** die Ausgabeansicht von „Mittag“ mit der Feldküche als einziger zugeordneter Stelle geöffnet ist und ein anderer Client „Mittag“ zusätzlich der Turnhalle zuordnet
- **THEN** bleibt die Feldküche gewählt, und die offene Sammlung zählt weiter an ihr

#### Scenario: Gerät merkt nichts
- **WHEN** das Verpflegungsgerät in der Ausgabeansicht von „Mittag“ (zwei zugeordnete Stellen) die Turnhalle wählt und die Ansicht später erneut öffnet
- **THEN** ist „ohne Stelle“ gewählt

#### Scenario: Gebundenes Gerät wählt keine Stelle
- **WHEN** das an die Feldküche gebundene Gerät die Ausgabeansicht von „Mittag“ öffnet und 4 EP zählt
- **THEN** steht dort fest „Stelle Feldküche BR Sportplatz“ ohne Auswahl, und die Ausgabe trägt die Feldküche

#### Scenario: Aufgelöste Stelle nicht wählbar
- **WHEN** die Feldküche aufgelöst ist und eine Person die Ausgabeansicht von „Mittag“ öffnet, auch mit der Feldküche in der Adresse
- **THEN** bietet die Stellenwahl die Feldküche nicht an, und sie ist nicht gewählt

### Requirement: Ausgabe zählen

Die Ausgabeansicht SHALL Portionen durch Tippen zählen: „+1“, „+5“ und „+10“ zählen so viele
Portionen Normalkost, „Menge …“ eine eingegebene Zahl, und je Kostform mit Bedarf größer 0 im
Zeitfenster zählt eine eigene Taste eine Portion dieser Kostform. Die übrigen Kostformen MUST
über ein Menü zählbar sein. Eine Portion einer Kostform MUST zugleich in die Menge zählen. Ein
Tipp MUST die angezeigte Sammlung ohne Netzanfrage sofort erhöhen. Die gezählten Portionen
bilden eine Sammlung. Die Oberfläche MUST eine Sammlung als genau eine Ausgabe mit genau einem
Idempotenzschlüssel `client_id` senden oder vormerken, und zwar sobald eine dieser Bedingungen
eintritt:

- 3 s ohne Tipp,
- 15 s nach dem ersten Tipp der Sammlung,
- 50 oder mehr Portionen in der Sammlung,
- „Buchen“,
- Wechsel der Stelle (Requirement „Ausgabeansicht eines Zeitfensters“),
- Wechsel des Empfängers (Requirement „Empfänger wählen“),
- das Zeitfenster wird vergangen,
- Wechsel des Zeitfensters oder Verlassen der Ansicht,
- die Seite wird verborgen oder beendet.

In den beiden letzten Fällen MUST die Oberfläche die Sammlung sofort ohne eigenen Sendeversuch
vormerken, die Warteschlange sendet sie. „−1“ MUST nur die zuletzt gezählte Portion der offenen
Sammlung zurücknehmen, auch eine Portion einer Kostform. Ohne offene Sammlung MUST „−1“
gesperrt stehen, mit dem Grund am Element. Eine gesendete Sammlung MUST ohne Zeitpunkt gehen (es
gilt die Serveruhr), eine vorgemerkte MUST den Zeitpunkt ihres Abschlusses tragen. Eine leere
Sammlung MUST keine Anfrage erzeugen. „Menge …“ MUST NOT mehr zulassen, als die Sammlung bis
zur Höchstmenge des Servers je Ausgabe noch aufnehmen kann. In einem vergangenen Zeitfenster
MUST die Ansicht nicht zählen. Die Zähltasten stehen dort gesperrt mit Grund, und das Nachtragen
bleibt möglich. Eine Sammlung MUST die Stelle und den Empfänger tragen, die bei ihrem ersten Tipp
gewählt waren; ohne gewählte Stelle geht sie ohne Stelle, ohne gewählten Empfänger ohne
Empfänger.

#### Scenario: Zählen und nach Ruhe buchen
- **WHEN** eine Person mit Verbindung im laufenden Zeitfenster „Mittag“ zwanzigmal „+1“ tippt und dann 3 s nichts tippt
- **THEN** zeigt die Ansicht während des Tippens die Sammlung 1 bis 20, ohne dass eine Anfrage gesendet wird
- **AND** danach ist genau eine Ausgabe über 20 EP mit einer `client_id` gespeichert

#### Scenario: Höchstdauer bei Dauerbetrieb
- **WHEN** eine Person alle 2 s „+1“ tippt
- **THEN** wird die Sammlung spätestens 15 s nach ihrem ersten Tipp als eine Ausgabe gebucht, und der nächste Tipp beginnt eine neue Sammlung

#### Scenario: Gruppe über Menge
- **WHEN** eine Person in einer leeren Sammlung über „Menge …“ 60 Portionen zählt
- **THEN** wird sofort eine Ausgabe über 60 EP gebucht

#### Scenario: Sonderkost zählt in die Menge
- **WHEN** in einer Sammlung dreimal „+1“ und zweimal „vegetarisch“ getippt wird und die Sammlung gebucht wird
- **THEN** ist genau eine Ausgabe über 5 EP mit 2 vegetarisch gespeichert, und der Server lehnt sie nicht ab

#### Scenario: Minus nimmt die letzte Portion
- **WHEN** in einer Sammlung „+1“ und danach „vegan“ getippt wird und dann „−1“
- **THEN** enthält die Sammlung eine Portion Normalkost und keine vegane Portion

#### Scenario: Menge an der Höchstgrenze
- **WHEN** eine Sammlung 10 Portionen enthält und eine Person über „Menge …“ 99 995 eingibt
- **THEN** lässt das Feld das nicht zu, und es entsteht keine Anfrage über der Grenze von 100 000 EP

#### Scenario: Minus ohne Sammlung
- **WHEN** keine Sammlung offen ist
- **THEN** ist „−1“ gesperrt, und der Grund steht am Element

#### Scenario: Sammlung auf null
- **WHEN** eine Sammlung mit einer Portion durch „−1“ leer wird
- **THEN** entsteht keine Anfrage und keine Ausgabe

#### Scenario: Tablet wird gesperrt
- **WHEN** während einer offenen Sammlung von 7 Portionen die Seite verborgen wird
- **THEN** steht die Sammlung als vorgemerkte Ausgabe über 7 EP in der Warteschlange mit dem Zeitpunkt ihres Abschlusses
- **AND** nach der Rückkehr ist sie genau einmal gespeichert

#### Scenario: Ansicht verlassen
- **WHEN** eine Person während einer offenen Sammlung von 4 Portionen zur Liste der Zeitfenster wechselt
- **THEN** steht die Sammlung ohne Rückfrage als eine Ausgabe über 4 EP in der Warteschlange
- **AND** mit Verbindung ist sie danach genau einmal gespeichert

#### Scenario: Abgelehnt nach dem Verlassen
- **WHEN** eine beim Verlassen der Ansicht vorgemerkte Sammlung beim Senden abgelehnt wird, weil ihr Zeitfenster inzwischen gelöscht ist
- **THEN** steht sie im Wiederherstellungsbereich mit dem Grund und dem vollständigen Inhalt

#### Scenario: Ohne Verbindung zählen
- **WHEN** eine Person ohne Netzverbindung zehnmal „+1“ tippt und 3 s wartet
- **THEN** steht eine Ausgabe über 10 EP als „ausstehend“ an der Ansicht, und Fehlmenge und Einstufung bleiben unverändert
- **AND** nach wiederhergestellter Verbindung ist sie genau einmal gespeichert, und die ausgegebene Menge ist um 10 gestiegen

#### Scenario: Wechsel der Stelle
- **WHEN** eine Person mit Verbindung an der Feldküche fünfmal „+1“ tippt und vor Ablauf der Ruhe die Turnhalle wählt
- **THEN** ist sofort eine Ausgabe über 5 EP an der Feldküche gespeichert
- **AND** der nächste Tipp beginnt eine neue Sammlung, die an der Turnhalle gebucht wird

#### Scenario: Vergangenes Zeitfenster
- **WHEN** die Ausgabeansicht eines Zeitfensters gezeigt wird, dessen Ende vorbei ist
- **THEN** sind alle Zähltasten gesperrt mit dem Grund „Zeitfenster vorbei“, und „Ausgabe nachtragen“ ist verfügbar

#### Scenario: Wechsel des Empfängers
- **WHEN** eine Person mit Verbindung bei gewählter Einheit „2. Gruppe“ fünfmal „+1“ tippt und vor Ablauf der Ruhe „ohne Empfänger“ wählt
- **THEN** ist sofort eine Ausgabe über 5 EP an die Einheit „2. Gruppe“ gespeichert
- **AND** der nächste Tipp beginnt eine neue Sammlung ohne Empfänger

### Requirement: Empfänger wählen

Die Ausgabeansicht SHALL im Kopf eine Empfängerwahl führen, sobald der Einsatz Einheiten oder
Abschnitte hat: „ohne Empfänger“ als Vorgabe, die nicht aufgelösten Einheiten in der Folge des
Kräftebaums mit Funkrufname und Ist-Stärke ihres Teilbaums, dann die Abschnitte als
„Zuführung“. Alle Angaben MUST aus der Empfängerliste der Verpflegung stammen (Requirement
„Empfängerliste der Verpflegung“). Ist eine Einheit mit Stärke gewählt, MUST daneben eine Taste
„+n“ stehen, die die Ist-Stärke ihres Teilbaums in die Sammlung zählt; „Menge …“ MUST mit
derselben Zahl vorbelegt sein. Beides MUST überschreibbar sein: „−1“ nimmt Portionen zurück, das
Feld nimmt eine andere Zahl. Ohne Stärke MUST es weder die Taste noch eine Vorbelegung geben. Die
Wahl MUST nirgends gemerkt werden; sie gilt bis zum Wechsel des Zeitfensters. Wird die gewählte
Einheit aufgelöst, MUST die Wahl auf „ohne Empfänger“ fallen. Ohne Schreibrecht und im
vergangenen Zeitfenster MUST die Wahl gesperrt stehen. Ohne Einheiten und Abschnitte MUST die
Empfängerwahl fehlen.

Das Formular „Ausgabe nachtragen“ SHALL dieselbe Wahl als Feld „Empfänger“ führen, dazu die
aufgelösten Einheiten mit Ausgabe als eigene Gruppe (für Nachträge vor der Auflösung). Wählt
eine Person eine Einheit mit Stärke, MUST das Formular die Menge mit der Ist-Stärke ihres
Teilbaums vorbelegen, solange die Menge leer ist oder noch die Vorbelegung trägt; eine
eingetragene Menge MUST stehen bleiben.

#### Scenario: Vorgabe ohne Empfänger
- **WHEN** eine Person die Ausgabeansicht von „Mittag“ öffnet und ohne weitere Wahl dreimal „+1“ tippt
- **THEN** ist „ohne Empfänger“ gewählt, und die Sammlung wird als Ausgabe über 3 EP ohne Empfänger gebucht

#### Scenario: Abholung durch eine Gruppe zählen
- **WHEN** eine Person in der Ausgabeansicht die Einheit „2. Gruppe“ (Stärke 0/1/8) wählt, „+9“ tippt und dann „−1“
- **THEN** wird die Sammlung als Ausgabe über 8 EP an die Einheit „2. Gruppe“ gebucht

#### Scenario: Zuführung zählen
- **WHEN** eine Person „Zuführung Deich“ wählt und 40 Portionen zählt
- **THEN** wird die Sammlung als Ausgabe über 40 EP an den Abschnitt „Deich“ gebucht, und neben der Wahl steht keine Stärke-Taste

#### Scenario: Nachtrag mit Vorbelegung
- **WHEN** eine Person in „Ausgabe nachtragen“ bei leerer Menge den Zug „Florian 1“ (kumuliert 1/2/17) wählt
- **THEN** steht in der Menge 20, und sie lässt sich vor dem Nachtragen ändern

#### Scenario: Eingetragene Menge bleibt
- **WHEN** eine Person in „Ausgabe nachtragen“ zuerst die Menge 12 einträgt und dann den Zug „Florian 1“ wählt
- **THEN** bleibt die Menge 12

#### Scenario: Beobachter
- **WHEN** eine Person ohne Schreibrecht die Ausgabeansicht öffnet
- **THEN** steht die Empfängerwahl gesperrt

### Requirement: Noch nicht verpflegt

Die Oberfläche SHALL je Zeitfenster zeigen, welche Einheiten noch nicht verpflegt sind, abgeleitet
aus den Ausgaben des Zeitfensters und der Empfängerliste; der Server liefert dafür keine eigene
Liste. Verpflegt MUST eine Einheit sein, an die oder an deren Über-Einheit eine nicht
zurückgenommene Ausgabe dieses Zeitfensters ging. Noch nicht verpflegt MUST jede übrige nicht
aufgelöste Einheit mit Eintreffen sein, außer sie ist erst nach dem Ende des Zeitfensters
eingetroffen. Einheiten ohne Eintreffen MUST die Oberfläche gesondert als „ohne Eintreffen“ zeigen
und MUST NOT sie als im Einsatz oder als abwesend werten. Eine Zuführung an einen Abschnitt MUST
keine Einheit als verpflegt zählen; die Zeilen der Einheiten in diesem Abschnitt oder darunter
MUST sie nennen. Eine auf dem Gerät vorgemerkte Ausgabe MUST an ihrer Einheit als „ausstehend“
stehen und MUST die Einheit nicht aus der Liste nehmen.

Die Liste „Noch nicht verpflegt“ MUST je Einheit Name, Funkrufname, Ist-Stärke des Teilbaums
und Abschnitt (eigener, sonst geerbter) zeigen, in der Folge des Kräftebaums mit eingerückten
Untereinheiten. Die Liste „Verpflegt“ MUST je Einheit, an die ausgegeben wurde, Menge und Zeit
jeder Ausgabe zeigen und die Zahl der mitverpflegten Untereinheiten, dazu je Abschnitt die
Zuführungen mit Menge und Zeit. Die Ausgabeansicht MUST beide Listen zeigen; jede noch nicht
verpflegte Zeile MUST dort „Wählen“ tragen, das die Einheit als Empfänger setzt (gesperrt ohne
Schreibrecht und im vergangenen Zeitfenster). Am Verpflegungsgerät MUST dasselbe gelten, allein
aus der Empfängerliste. Am an eine Verpflegungsstelle gebundenen Gerät (LLH-1048) MUST eine
Einheit, für die der Server eine Menge anderswo liefert (`verpflegt_anderswo`, an einer anderen
Stelle oder ohne Stelle), samt ihrem Teilbaum als verpflegt gelten und unter „Verpflegt“ als
„anderswo verpflegt“ mit dieser Menge stehen, ohne Zeit; mehr als der Server liefert MUST die
Oberfläche nicht ableiten.

#### Scenario: Eine von drei verpflegt
- **WHEN** der Einsatz drei eingetroffene Einheiten führt und zum Zeitfenster „Mittag“ eine Ausgabe an eine von ihnen ging
- **THEN** listet „Noch nicht verpflegt“ die beiden anderen, und „Verpflegt“ nennt die eine mit Menge und Zeit

#### Scenario: Zurückgenommene Ausgabe
- **WHEN** die einzige Ausgabe an die „2. Gruppe“ zurückgenommen ist
- **THEN** steht die „2. Gruppe“ wieder unter „Noch nicht verpflegt“

#### Scenario: Ausgabe an den Zug
- **WHEN** zum Zeitfenster „Mittag“ eine Ausgabe an den Zug „Florian 1“ ging, dem zwei Gruppen unterstehen
- **THEN** steht keine der drei Einheiten unter „Noch nicht verpflegt“, und „Verpflegt“ nennt den Zug mit zwei Untereinheiten

#### Scenario: Ohne Eintreffen
- **WHEN** die Einheit „Wasserrettung“ kein Eintreffen in ihrer Zeitachse hat und keine Ausgabe bekam
- **THEN** steht sie unter „ohne Eintreffen“, nicht unter „Noch nicht verpflegt“

#### Scenario: Erst nach dem Zeitfenster eingetroffen
- **WHEN** eine Einheit um 14:00 eingetroffen ist und das Zeitfenster „Mittag“ um 13:30 endete
- **THEN** steht sie für „Mittag“ in keiner der Listen

#### Scenario: Zuführung an den Abschnitt
- **WHEN** zum Zeitfenster „Mittag“ 40 EP an den Abschnitt „Deich“ zugeführt wurden
- **THEN** stehen die Einheiten im Abschnitt „Deich“ weiter unter „Noch nicht verpflegt“, mit dem Hinweis auf die Zuführung, und „Verpflegt“ nennt die Zuführung mit Menge und Zeit

#### Scenario: Vorgemerkt ohne Netz
- **WHEN** ohne Netzverbindung 9 EP an die „2. Gruppe“ vorgemerkt sind
- **THEN** steht die „2. Gruppe“ weiter unter „Noch nicht verpflegt“ mit „ausstehend 9 EP“

#### Scenario: Anderswo verpflegt
- **WHEN** die „2. Gruppe“ zum Zeitfenster „Abend“ 40 EP an der Turnhalle bekam und das Gerät der Feldküche „Noch nicht verpflegt“ zeigt
- **THEN** steht die „2. Gruppe“ nicht unter „Noch nicht verpflegt“, sondern unter „Verpflegt“ als „anderswo verpflegt · 40 EP“

#### Scenario: Einheit wählen
- **WHEN** eine Person in der Ausgabeansicht an der Zeile der „2. Gruppe“ „Wählen“ tippt
- **THEN** ist die „2. Gruppe“ als Empfänger gewählt

### Requirement: Verpflegungsplan der Organisation

Das System SHALL je Organisation einen Verpflegungsplan führen: eine Liste von Mahlzeiten mit
Bezeichnung, Beginn und Ende als Uhrzeit ohne Datum und ohne Zeitzone (`HH:MM`, 00:00–23:59) und
optional einer Verpflegungsart. Liegt das Ende vor dem Beginn, MUST die Mahlzeit als am Folgetag
endend gelten; ein Ende gleich dem Beginn MUST mit 422 abgelehnt werden. Die Bezeichnung MUST
unter den aktiven Mahlzeiten einer Organisation eindeutig sein, ohne Unterschied von Groß- und
Kleinschreibung (409 bei Dublette). Eine Mahlzeit MUST NOT gelöscht werden; sie wird deaktiviert
und kann wieder aktiviert werden. Die Liste MUST nach Beginn geordnet sein. Lesen SHALL jedem
angemeldeten Mitglied der Organisation offenstehen; Anlegen und Ändern MUST dem Admin vorbehalten
sein (403 sonst). Mahlzeiten anderer Organisationen MUST wie nicht vorhanden behandelt werden
(404). Der Plan trägt keinen Bedarf.

#### Scenario: Mahlzeit anlegen
- **WHEN** der Admin die Mahlzeit „Frühstück“ mit Beginn `0630` und Ende `08:00` anlegt
- **THEN** antwortet das System mit 201, und der Plan führt „Frühstück 06:30–08:00“

#### Scenario: Nachtverpflegung über Mitternacht
- **WHEN** der Admin die Mahlzeit „Nachtverpflegung“ mit Beginn 23:00 und Ende 01:00 anlegt
- **THEN** wird sie angelegt und gilt als am Folgetag um 01:00 endend

#### Scenario: Ende gleich Beginn
- **WHEN** eine Mahlzeit mit Beginn und Ende 12:00 angelegt oder auf diese Zeiten geändert wird
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Unlesbare Uhrzeit
- **WHEN** eine Mahlzeit mit dem Beginn „24:00“ oder „6.30 Uhr“ angelegt wird
- **THEN** antwortet das System mit 400 und legt nichts an

#### Scenario: Name doppelt
- **WHEN** der Admin neben der aktiven Mahlzeit „Mittag“ eine Mahlzeit „mittag“ anlegt
- **THEN** antwortet das System mit 409

#### Scenario: Deaktivierte Mahlzeit
- **WHEN** der Admin die Mahlzeit „Nachtverpflegung“ deaktiviert
- **THEN** fehlt sie in der Liste ohne `nur_aktive=false`, erscheint mit ihr als inaktiv, und eine neue aktive Mahlzeit „Nachtverpflegung“ ist wieder möglich

#### Scenario: Einsatzkraft schreibt
- **WHEN** ein Mitglied ohne Admin-Recht eine Mahlzeit ändert
- **THEN** antwortet das System mit 403

### Requirement: Tag aus der Vorlage anlegen

Das System SHALL mehrere Zeitfenster eines Einsatztages in einer Anfrage anlegen. Die Anfrage
nennt die Grenzen des Tages und je Zeitfenster Bezeichnung, Beginn, Ende, Bedarf, Sonderkost und
optional die Verpflegungsart, wie beim Anlegen eines einzelnen Zeitfensters. Jedes entstehende
Zeitfenster MUST ein gewöhnliches, von der Vorlage und von anderen Tagen unabhängiges
Zeitfenster sein; es MUST keine Serie entstehen, die sich fortschreibt, und keine Kopplung an
Schichten. Das System MUST alle Zeitfenster in einer Transaktion anlegen: scheitert eines, MUST
nichts angelegt werden, und die Meldung MUST die Bezeichnung nennen. Je angelegtem Zeitfenster
MUST genau ein ETB-Eintrag mit demselben Inhalt wie beim Einzelanlegen entstehen. Ein
Zeitfenster, dessen Bezeichnung (getrimmt, ohne Unterschied von Groß- und Kleinschreibung) im
Einsatz schon ein Zeitfenster trägt, das an diesem Tag beginnt, MUST übersprungen und in der
Antwort genannt werden. Die Tagesgrenzen MUST 23 bis 25 Stunden auseinanderliegen, jeder Beginn
MUST innerhalb des Tages liegen, und eine Bezeichnung MUST in der Anfrage höchstens einmal
vorkommen, sonst 422. Feldfehler (400: unlesbarer Zeitpunkt, leere oder zu lange Bezeichnung,
negativer Bedarfsteil, unbekannte Verpflegungsart) irgendeines Zeitfensters der Anfrage MUST vor
jeder Prüfung des Zusammenhangs (422) gemeldet werden. Die angelegten Zeitfenster MUST keiner
Verpflegungsstelle zugeordnet sein. Die Anfrage verlangt dieselben Rechte wie das Einzelanlegen.
Nach dem Commit MUST genau ein Live-Ereignis `verpflegung` verteilt werden, dazu je ETB-Eintrag
das ETB-Ereignis; entsteht kein Zeitfenster, MUST weder ein ETB-Eintrag noch ein Live-Ereignis
entstehen.

#### Scenario: Drei Zeitfenster für einen Tag
- **WHEN** für den Tag 2026-10-10 22:00 bis 2026-10-11 22:00 UTC die Zeitfenster „Frühstück“ 04:30–06:00, „Mittag“ 10:00–11:30 und „Abendessen“ 16:00–17:30 UTC mit Bedarf angelegt werden
- **THEN** antwortet das System mit 201 und nennt drei angelegte Zeitfenster und kein übersprungenes
- **AND** das ETB enthält genau drei neue System-Einträge, je einen wie beim Einzelanlegen

#### Scenario: Gleichnamiges Zeitfenster am selben Tag
- **WHEN** im Einsatz schon „Mittag“ am 11.10. beginnt und für den 11.10. „Frühstück“, „mittag“ und „Abendessen“ angelegt werden
- **THEN** entstehen „Frühstück“ und „Abendessen“, „mittag“ steht als übersprungen in der Antwort, und für „mittag“ entsteht kein ETB-Eintrag

#### Scenario: Alles schon angelegt
- **WHEN** jedes übergebene Zeitfenster übersprungen wird
- **THEN** antwortet das System mit 200, nennt alle als übersprungen und verteilt weder ETB-Eintrag noch Live-Ereignis

#### Scenario: Gleicher Name am Vortag
- **WHEN** „Abendessen“ nur am 10.10. im Einsatz besteht und für den 11.10. „Abendessen“ angelegt wird
- **THEN** wird „Abendessen“ für den 11.10. angelegt

#### Scenario: Ein Zeitfenster scheitert
- **WHEN** in einer Anfrage mit drei Zeitfenstern bei „Abendessen“ die Sonderkost den Gesamtbedarf übersteigt
- **THEN** antwortet das System mit 422 mit einer Meldung, die „Abendessen“ nennt, und legt keines der drei Zeitfenster an

#### Scenario: Beginn außerhalb des Tages
- **WHEN** ein übergebenes Zeitfenster vor `tag_von_at` oder ab `tag_bis_at` beginnt
- **THEN** antwortet das System mit 422 und legt nichts an

#### Scenario: Feldfehler vor dem Zusammenhang
- **WHEN** in einer Anfrage beim ersten Zeitfenster die Sonderkost den Gesamtbedarf übersteigt und das dritte eine leere Bezeichnung trägt
- **THEN** antwortet das System mit 400 und legt nichts an

#### Scenario: Unabhängig nach dem Anlegen
- **WHEN** ein aus der Vorlage angelegtes „Mittag“ geändert oder die Mahlzeit „Mittag“ im Verpflegungsplan geändert oder deaktiviert wird
- **THEN** ändert sich jeweils nur das eine, und kein anderer Tag erhält ein Zeitfenster

#### Scenario: Beobachter und abgeschlossener Einsatz
- **WHEN** eine Person ohne Schreibrecht bzw. eine Person in einem abgeschlossenen Einsatz einen Tag aus der Vorlage anlegt
- **THEN** antwortet das System mit 403 bzw. 409 und legt nichts an

#### Scenario: Verpflegungsgerät
- **WHEN** ein gekoppeltes Verpflegungsgerät einen Tag aus der Vorlage anlegen oder den Verpflegungsplan lesen will
- **THEN** antwortet der Server mit 403, und die Geräteansicht bietet keinen Einstieg

### Requirement: Verpflegungsplan in der Verwaltung

Die Verwaltung SHALL unter den Stammdaten einen Bereich „Verpflegungsplan“ führen, der alle
Mahlzeiten der Organisation zeigt, aktive und deaktivierte, in der Folge des Servers (nach Beginn).
Jede Mahlzeit MUST Bezeichnung, Beginn und Ende als taktische Uhrzeit („0630–0800“), die Art (wenn
gesetzt) und ihren Zustand als Wort („Aktiv“, „Inaktiv“) zeigen; endet sie am Folgetag, MUST „+1 Tag“
dabeistehen. Der Admin MUST Mahlzeiten anlegen und bearbeiten (Bezeichnung, Beginn, Ende, Art)
sowie deaktivieren und wieder aktivieren können; Deaktivieren und Aktivieren sind umkehrbar und
MUST ohne Rückfrage wirken. Die Uhrzeiten MUST über die Maske einer Uhrzeit ohne Datum eingegeben
werden (Spec `zeiteingabe`, „Uhrzeit ohne Datum“); eine unlesbare Uhrzeit und ein Ende gleich dem
Beginn MUST am Feld stehen, ohne dass die Maske sendet. Ein Ende vor dem Beginn MUST in der Maske
als Folgetag erkennbar sein. Ändern MUST nur die geänderten Angaben senden. Ohne Admin-Recht MUST
„Mahlzeit anlegen“ gesperrt mit Grund stehen, und die Zeilenaktionen MUST fehlen. Ändert jemand den
Plan, MUST jede offene Ansicht des Plans der Organisation ihn ohne Neuladen zeigen (Org-Ereignis
`stammdaten`).

#### Scenario: Plan ansehen
- **WHEN** der Plan „Frühstück“ 06:30–08:00 und „Nachtverpflegung“ 23:00–01:00 (kalt) führt
- **THEN** zeigt die Verwaltung „0630–0800“ und „2300–0100“ mit „+1 Tag“ und „kalt“

#### Scenario: Mahlzeit in Stab-Schreibweise anlegen
- **WHEN** der Admin „Frühstück“ mit Beginn „630“ und Ende „0800“ anlegt
- **THEN** sendet die Maske Beginn `06:30` und Ende `08:00`

#### Scenario: Ende gleich Beginn in der Maske
- **WHEN** der Admin Beginn und Ende 12:00 eingibt
- **THEN** steht „Ende gleich Beginn“ am Feld, und die Maske sendet nichts

#### Scenario: Deaktivierte Mahlzeit wieder aktivieren
- **WHEN** der Admin bei der inaktiven Mahlzeit „Kaffee“ „Aktivieren“ wählt und der Server mit 409 ablehnt, weil eine aktive Mahlzeit so heißt
- **THEN** steht der Grund über der Tabelle, und „Kaffee“ bleibt inaktiv

#### Scenario: Ohne Admin-Recht
- **WHEN** ein Mitglied ohne Admin-Recht den Verpflegungsplan öffnet
- **THEN** sieht es den Plan, „Mahlzeit anlegen“ gesperrt mit Grund und keine Zeilenaktionen

### Requirement: Tag aus der Vorlage in der Oberfläche

Die Seite des Moduls SHALL mit Schreibrecht einen Nebenweg „Tag aus Vorlage anlegen“ tragen, der
eine eigene Seite mit Adresse öffnet (`…/verpflegung/aus-vorlage?tag=JJJJ-MM-TT`). Ohne Schreibrecht
MUST der Nebenweg gesperrt mit Grund stehen; am Verpflegungsgerät MUST er fehlen. Die Seite MUST
einen Kalendertag wählen lassen, Vorgabe ist heute im Kalender der Anzeigezone nach der Serveruhr.
Sie MUST je aktiver Mahlzeit des Verpflegungsplans ein Fenster zeigen: Bezeichnung, Zeitraum in der
Anzeigezone (über Mitternacht bis zum Folgetag), Art und je einen Bedarf für Einsatzkräfte und
Betreute, vorbelegt wie beim Anlegen eines einzelnen Zeitfensters (Requirement
„Bedarfsvorschläge aus Personal und Betreuung“), je Fenster zu dessen Beginn; ohne Quelle MUST das
Feld leer bleiben und vor dem Absenden gefüllt werden. Jedes Fenster MUST sich abwählen lassen; ein
abgewähltes MUST nicht gesendet werden und verlangt keinen Bedarf. Beginnt am Tag schon ein
gleichnamiges Zeitfenster, MUST das Fenster als „schon angelegt“ stehen und nicht gesendet werden.
Liegt ein Fenster ganz in der ausfallenden Stunde einer Sommerzeit-Umstellung, sodass sein Ende
nicht nach dem Beginn liegt, MUST es als nicht anlegbar stehen und nicht gesendet werden. Die
Uhrzeiten MUST in der Anzeigezone auf den Tag gelegt werden (Spec `zeiteingabe`, „Uhrzeit ohne
Datum“), die Tagesgrenzen ebenso. „Zeitfenster anlegen“ MUST alle gewählten Fenster in einer
Anfrage senden, ohne weitere Personen, Sonderkost und Stellen; danach MUST die Oberfläche zur Seite
des Moduls zurückkehren und eine Rückmeldung zeigen, die die Zahl der angelegten Zeitfenster, den
Tag und jedes übersprungene Fenster nennt. Eine Ablehnung MUST auf der Seite stehen, und die Seite
MUST bleiben. Hat die Vorschau Fenster, MUST sie bei Live-Änderungen stehen bleiben; was
inzwischen am Tag besteht, überspringt der Server. Ist der Plan leer, MUST die Seite das sagen und
dem Admin den Weg in den Verpflegungsplan zeigen.

#### Scenario: Vorschau des 11.10.
- **WHEN** die Anzeigezone Europe/Berlin ist, der Browser auf UTC steht und die Seite für den 11.10.2026 mit dem Plan „Frühstück“ 06:30–08:00 und „Nachtverpflegung“ 23:00–01:00 geöffnet wird
- **THEN** zeigt sie „11.10. 06:30–08:00“ und „11.10. 23:00–12.10. 01:00“, und gesendet werden `2026-10-11 04:30:00` bis `06:00:00` bzw. `2026-10-11 21:00:00` bis `23:00:00`

#### Scenario: Vorschlag ohne Quelle
- **WHEN** für den Beginn von „Frühstück“ keine Betreuungsstelle eine Belegung gemeldet hat
- **THEN** bleibt das Feld Betreute leer mit „keine Belegung gemeldet“, und „Zeitfenster anlegen“ verlangt eine Zahl

#### Scenario: Schon angelegt
- **WHEN** im Einsatz schon „Mittag“ am 11.10. beginnt und die Seite für den 11.10. geöffnet wird
- **THEN** steht „Mittag“ als „schon angelegt“ ohne Bedarfsfelder, und die Anfrage enthält „Mittag“ nicht

#### Scenario: Quittung nennt Übersprungenes
- **WHEN** der Server ein Fenster anlegt und „Abendessen“ überspringt
- **THEN** kehrt die Oberfläche zur Verpflegung zurück und meldet „1 Zeitfenster für den 11.10. angelegt · am Tag schon vorhanden: ‚Abendessen‘“

#### Scenario: Umstellung im März
- **WHEN** der Plan eine Mahlzeit 02:00–03:00 führt und die Seite für den 29.03.2026 in Europe/Berlin geöffnet wird
- **THEN** steht diese Mahlzeit als nicht anlegbar und wird nicht gesendet

#### Scenario: Ohne Schreibrecht
- **WHEN** eine Person ohne Schreibrecht die Seite des Moduls öffnet
- **THEN** steht „Tag aus Vorlage anlegen“ gesperrt mit Grund, und auf der Seite des Tages ist „Zeitfenster anlegen“ gesperrt
