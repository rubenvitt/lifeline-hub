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
optional eine Verpflegungsstelle, optional Ort, Sonderkost je Kostform, optional den Verweis auf
eine Nachforderung und optional eine Bemerkung. Ausgaben MUST append-only sein: Es gibt keine
Bearbeitung, eine falsche Ausgabe wird zurückgenommen. Das System MUST einen Zeitpunkt außerhalb
des Zeitfensters annehmen (Anlieferung vor Beginn).

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
- **THEN** nennt der ETB-Eintrag den Zeitraum 24.09. 12:00–13:30

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
Gerät vormerken und bei wiederhergestellter Verbindung senden. Die vorgemerkte Ausgabe MUST den
Zeitpunkt der Erfassung tragen, wenn keiner eingetragen ist. Der Hinweis nach dem Vormerken MUST
ohne „Rückgängig“ erscheinen. Eine fachlich abgelehnte Ausgabe MUST mit Grund und Inhalt sichtbar
bleiben, bis sie verworfen oder erneut versucht wird.

#### Scenario: Ausgabe ohne Verbindung
- **WHEN** eine Person ohne Netzverbindung im Dialog „Ausgabe erfassen“ 120 EP zu „Mittag“ erfasst
- **THEN** zeigt die Seite einen Hinweis, dass die Ausgabe vorgemerkt ist, und bietet kein „Rückgängig“ an
- **AND** nach wiederhergestellter Verbindung ist die Ausgabe genau einmal gespeichert, mit dem Zeitpunkt der Erfassung

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
schreibt keinen ETB-Eintrag. Ändern, Statuswechsel und Storno einer stornierten Stelle MUST mit 409
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
nach der Prüfung auf einen aktiven Einsatz laufen.

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
Zurückgenommene Ausgaben MUST nicht zählen.

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
jede Ausgabe keinen ETB-Eintrag schreiben.

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

### Requirement: Empfängerliste der Verpflegung

Die Antwort des Verpflegungsmoduls SHALL eine Empfängerliste enthalten: alle nicht aufgelösten
Einheiten des Einsatzes mit Name, Funkrufname, Über-Einheit, Abschnitt, eigener und kumulierter
Ist-Stärke und dem Zeitpunkt des Eintreffens, dazu die aufgelösten Einheiten, auf die eine Ausgabe
verweist, und alle Abschnitte mit Name und Über-Abschnitt. Die Stärken MUST aus derselben Rechnung
stammen wie in der Einheitenliste. Das Eintreffen MUST das nicht gestrichene Eintreffen der
jüngsten Einsatzperiode sein und fehlen, wenn es keins gibt. Die Liste MUST NOT Einheitsführer,
Erreichbarkeit, Kommunikationsmittel, Bemerkung, Mitglieder, Fahrzeuge oder Material enthalten.
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
- **WHEN** eine Einheit mit Einheitsführer, Erreichbarkeit und Personal in der Empfängerliste steht
- **THEN** enthält die Antwort weder den Namen des Einheitsführers noch die Erreichbarkeit noch Namen von Mitgliedern

#### Scenario: Leser ohne Modul Einheiten
- **WHEN** eine Person die Verpflegung lesen darf, das Modul Einheiten für sie aber ausgeblendet ist
- **THEN** erhält sie die Empfängerliste mit den Namen der Einheiten
- **AND** die Einheitenliste des Einsatzes beantwortet das System ihr weiter mit 403

#### Scenario: Aufgelöste Einheit mit Ausgabe
- **WHEN** die Einheit „2. Gruppe“ eine Ausgabe bekommen hat und danach aufgelöst wurde
- **THEN** steht sie in der Empfängerliste mit ihrem Namen und dem Zeitpunkt der Auflösung
