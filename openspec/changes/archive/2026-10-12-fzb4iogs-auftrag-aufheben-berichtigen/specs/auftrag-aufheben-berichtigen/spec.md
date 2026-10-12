# Spec Delta

## Purpose

Ein erteilter Einzelauftrag lässt sich mit Pflichtgrund aufheben und vor der ersten Quittung
berichtigen. Beide Vorgänge sind Führungsvorgänge und stehen im Einsatztagebuch. Ein aufgehobener
Auftrag zählt nirgends mehr als offen.

## ADDED Requirements

### Requirement: Auftrag aufheben
Das System SHALL unter `POST /api/einsaetze/{id}/auftraege/{aid}/aufheben` einen Auftrag aufheben.
Der Body MUST einen nicht leeren `grund` tragen, sonst antwortet der Server mit 400.

- Aufheben MUST aus den Bearbeitungsstatus „offen“, „in Arbeit“ und „vollzogen“ möglich sein.
- Ein abgenommener oder schon aufgehobener Auftrag MUST mit 422 abgelehnt werden.
- Das Recht ist das Schreibrecht im Modul Aufträge (Einsatzleitung oder Führungspersonal). Ohne
  dieses Recht MUST der Server mit 403 antworten.
- An einem abgeschlossenen Einsatz MUST der Server mit 409 antworten.
- Ein Auftrag eines anderen Einsatzes MUST 404 ergeben.

Nach dem Aufheben MUST der Bearbeitungsstatus `aufgehoben` sein. Der Auftrag MUST dabei
Zeitpunkt, aufhebende Person und Grund tragen. Das Aufheben MUST unumkehrbar sein: Es gibt keinen
Weg zurück in einen anderen Status. Antwort ist der Auftrag im neuen Stand, und das Live-Ereignis
`auftrag` MUST erst nach dem Commit gesendet werden.

#### Scenario: Offenen Auftrag aufheben
- **WHEN** die Einsatzleitung Auftrag #4 im Status „offen“ mit dem Grund „Lage hat sich erledigt“
  aufhebt
- **THEN** antwortet der Server mit 200 und `bearbeitungsstatus: "aufgehoben"`
- **AND** der Auftrag trägt den Grund, die aufhebende Person und den Zeitpunkt

#### Scenario: Vollzogenen, nicht abgenommenen Auftrag aufheben
- **WHEN** ein vollzogener Auftrag vor der Abnahme aufgehoben wird
- **THEN** ist sein Bearbeitungsstatus `aufgehoben`, und die Vollzugsmeldung bleibt erhalten

#### Scenario: Abgenommener Auftrag
- **WHEN** ein abgenommener Auftrag aufgehoben werden soll
- **THEN** antwortet der Server mit 422, und nichts ändert sich

#### Scenario: Zweimal aufheben
- **WHEN** ein aufgehobener Auftrag noch einmal aufgehoben werden soll
- **THEN** antwortet der Server mit 422, und kein weiterer ETB-Eintrag entsteht

#### Scenario: Leerer Grund
- **WHEN** der Grund fehlt oder nur aus Leerzeichen besteht
- **THEN** antwortet der Server mit 400, und der Auftrag bleibt unverändert

#### Scenario: Beobachter
- **WHEN** ein Mitglied mit der Einsatzrolle Beobachter einen Auftrag aufheben will
- **THEN** antwortet der Server mit 403

#### Scenario: Abgeschlossener Einsatz
- **WHEN** ein Auftrag an einem abgeschlossenen Einsatz aufgehoben werden soll
- **THEN** antwortet der Server mit 409

#### Scenario: Abschnittsgerät
- **WHEN** das gekoppelte Gerät eines Einsatzabschnitts einen Auftrag an seinen Abschnitt aufheben
  oder berichtigen will
- **THEN** lehnt der Server die Anfrage ab, wie jeden Weg, den die Ansicht Einsatzabschnitt nicht
  nennt

### Requirement: Folgen des Aufhebens
Ein aufgehobener Auftrag MUST keine Quittung, keinen Vollzug und keine Abnahme mehr annehmen:
Quittieren, Vollzug melden (auch die Rücknahme) und Abnehmen MUST mit 422 abgelehnt werden.
Unquittierte Empfänger MUST unquittiert bleiben, sie werden nicht nachträglich als quittiert
geführt. Die offene Erinnerung „Quittierfrist“ des Auftrags (Quelle Auto-Frist) MUST in derselben
Transaktion geschlossen werden. Erinnerungen, die ein Mensch selbst zum Auftrag angelegt hat,
MUST bestehen bleiben.

#### Scenario: Quittieren nach dem Aufheben
- **WHEN** ein Empfänger einen aufgehobenen Auftrag quittieren will
- **THEN** antwortet der Server mit 422, und die Empfängerzeile bleibt unquittiert

#### Scenario: Erinnerung endet
- **WHEN** ein Auftrag mit Frist und unquittiertem Empfänger aufgehoben wird
- **THEN** ist seine Erinnerung „Quittierfrist“ geschlossen und löst nach Fristablauf keinen Alarm
  aus

### Requirement: Aufheben steht im Einsatztagebuch
Das Aufheben MUST in derselben Transaktion genau einen ETB-Eintrag vom Typ „Anordnung“ erzeugen,
unabhängig vom Schalter „Automatische ETB-Einträge“. Der Inhalt lautet
„Auftrag #<Nummer> aufgehoben: <Grund>“, ohne Nummer „Auftrag aufgehoben: <Grund>“. „An“ trägt die
Empfänger wie die Anordnung beim Erteilen. Der Eintrag MUST auf den Auftrag verweisen und MUST
keinen Folgeauftrag tragen. Scheitert der ETB-Eintrag, MUST das ganze Aufheben scheitern.

#### Scenario: Wortlaut
- **WHEN** Auftrag #4 an den Logistiktrupp mit dem Grund „Material kommt vom Bauhof“ aufgehoben wird
- **THEN** steht im ETB eine Anordnung mit dem Inhalt „Auftrag #4 aufgehoben: Material kommt vom
  Bauhof“ und „An: Logistiktrupp“

#### Scenario: Ursprüngliche Anordnung bleibt
- **WHEN** ein Auftrag aufgehoben wird, dessen Erteilen eine Anordnung im ETB erzeugt hat
- **THEN** bleibt dieser Eintrag unverändert stehen, und der Aufhebungs-Eintrag kommt dazu

### Requirement: Auftrag berichtigen
Das System SHALL unter `PATCH /api/einsaetze/{id}/auftraege/{aid}` einen Auftrag berichtigen.
Änderbar sind Auftragstext, Empfänger, Priorität, Frist und jedes Feld des Befehlsschemas.

- Ein fehlendes Feld MUST unverändert bleiben. `null` MUST ein optionales Feld leeren.
- Empfänger MUST als vollständige neue Liste ersetzt werden.
- Für Text und Empfänger MUST dieselbe Prüfung gelten wie beim Erteilen: Pflicht, Grenzen,
  Zusammenführen gleicher Empfänger und der Funktions-Snapshot.

Berichtigen MUST nur möglich sein, solange der Bearbeitungsstatus „offen“ ist und kein Empfänger
quittiert hat; sonst MUST der Server mit 422 antworten. Die Prüfung MUST in derselben Transaktion
wie das Schreiben liegen, damit eine gleichzeitige Quittung nicht übergangen wird. Rechte, 403,
409 und 404 wie beim Aufheben.

Ändert ein Patch fachlich nichts, MUST nichts geschrieben werden: kein ETB-Eintrag, kein
Live-Ereignis. Antwort ist der Auftrag im aktuellen Stand.

#### Scenario: Frist berichtigen
- **WHEN** die Frist eines unquittierten Auftrags von 15:00 auf 16:00 geändert wird
- **THEN** antwortet der Server mit 200 und der neuen Frist
- **AND** alle übrigen Felder sind unverändert

#### Scenario: Nach der ersten Quittung
- **WHEN** einer von zwei Empfängern quittiert hat und der Auftragstext geändert werden soll
- **THEN** antwortet der Server mit 422, und der Auftrag bleibt unverändert

#### Scenario: In Arbeit
- **WHEN** ein Auftrag im Status „in Arbeit“ ohne Quittung berichtigt werden soll
- **THEN** antwortet der Server mit 422

#### Scenario: Empfänger tauschen
- **WHEN** die Empfängerliste von „Logistiktrupp“ auf „Versorgungszug“ geändert wird
- **THEN** hat der Auftrag genau den Empfänger „Versorgungszug“, unquittiert

#### Scenario: Patch ohne Änderung
- **WHEN** ein Patch genau die bestehenden Werte sendet
- **THEN** antwortet der Server mit 200, und es entsteht kein ETB-Eintrag

### Requirement: Berichtigen steht im Einsatztagebuch
Eine Berichtigung mit fachlicher Änderung MUST in derselben Transaktion genau einen ETB-Eintrag
vom Typ „Anordnung“ erzeugen, unabhängig vom Schalter „Automatische ETB-Einträge“. Der Inhalt
lautet „Auftrag #<Nummer> geändert: <Änderungen>.“.

Die Änderungen MUST je geändertem Feld den neuen und den vorherigen Wert nennen, etwa
„Frist 12.10. 16:00 (vorher 12.10. 15:00)“. Zeiten MUST dabei in der Zeitzone des Einsatzes stehen.
Ein geänderter Auftragstext MUST wörtlich mit dem neuen Wortlaut erscheinen. Das ist nötig, weil
der Eintrag die Anordnung im ETB fortschreibt. Die Felder des Befehlsschemas MUST nur mit ihrem
Namen erscheinen, nicht mit ihrem Inhalt.

„An“ trägt die Empfänger nach der Berichtigung. Der Eintrag MUST auf den Auftrag verweisen und
MUST keinen Folgeauftrag tragen. Bestehende ETB-Einträge des Auftrags MUST unverändert bleiben.

#### Scenario: Zwei Felder geändert
- **WHEN** an Auftrag #4 Frist und Priorität berichtigt werden
- **THEN** steht im ETB genau eine Anordnung „Auftrag #4 geändert: Priorität sofort (vorher
  normal), Frist 12.10. 16:00 (vorher 12.10. 15:00).“

#### Scenario: Schemafeld geändert
- **WHEN** nur das Schemafeld „Mittel“ berichtigt wird
- **THEN** lautet der Eintrag „Auftrag #4 geändert: Mittel.“

### Requirement: Berichtigte Frist führt die Erinnerung nach
Ändert eine Berichtigung die Frist, MUST die Erinnerung „Quittierfrist“ des Auftrags in derselben
Transaktion folgen:

- Eine neue Frist MUST die bestehende Erinnerung auf den neuen Zeitpunkt setzen und ihren Auslöser
  zurücksetzen. Fehlt die Erinnerung, MUST eine neue entstehen.
- Eine entfernte Frist MUST die Erinnerung schließen.

#### Scenario: Frist verschoben nach Alarm
- **WHEN** die Quittierfrist abgelaufen ist, der Alarm ausgelöst hat und die Frist auf eine Stunde
  später berichtigt wird
- **THEN** ist der Auftrag nicht mehr überfällig, und die Erinnerung löst zur neuen Frist wieder
  aus

#### Scenario: Frist entfernt
- **WHEN** die Frist eines Auftrags per Berichtigung geleert wird
- **THEN** ist seine Erinnerung „Quittierfrist“ geschlossen

### Requirement: Aufgehoben zählt nie als offen
Der Bearbeitungsstatus `aufgehoben` MUST zur Abgeschlossen-Phase gehören. Er MUST nie als offen
und nie als überfällig gelten, auch wenn die Frist abgelaufen ist und Empfänger unquittiert sind.

Das MUST gleich gelten für:
- Modulzähler, Kennzahlen und den `phase`-Filter der Auftragsliste,
- die Zahlen im Überblick, in der Vorbereitung der Lagebesprechung und im Lagedashboard,
- die Lagebericht-Übernahme „Besondere (Führungs-)Probleme“,
- die Auftragsliste des Abschnittsgeräts.

In der Abschnittsbilanz des Überblicks MUST ein aufgehobener Auftrag weder als erledigt noch im
Gesamt zählen. In der Liste der Folgeaufträge eines ETB-Eintrags MUST er weiter erscheinen, denn
er wurde erteilt. Das gemeinsame Fixture beider Sprachen MUST den Fall „aufgehoben mit
abgelaufener Frist“ enthalten.

Die Abgeschlossen-Ansicht MUST aufgehobene Aufträge nach dem Zeitpunkt des Aufhebens einordnen.

#### Scenario: Überfälliger Auftrag wird aufgehoben
- **WHEN** ein überfälliger offener Auftrag aufgehoben wird
- **THEN** sinken `auftraege.offen` und `auftraege.ueberfaellig` im Modulzähler je um 1
- **AND** die Vorbereitung der Lagebesprechung und das Lagedashboard zeigen dieselben Zahlen

#### Scenario: Lagebericht-Übernahme
- **WHEN** ein überfälliger Auftrag aufgehoben ist und die Übernahme „Besondere
  (Führungs-)Probleme“ läuft
- **THEN** nennt sie diesen Auftrag nicht

#### Scenario: Abschnittsbilanz
- **WHEN** ein Abschnitt drei Aufträge hat, einen vollzogen, einen offen und einen aufgehoben
- **THEN** zeigt die Bilanz „1 von 2 erledigt“

### Requirement: Aufheben und Berichtigen in der Oberfläche
Die Auftragskarte SHALL die Handlungen „Berichtigen“ und „Auftrag aufheben“ nur für Mitglieder mit
Schreibrecht anbieten. „Berichtigen“ steht nur bereit, solange der Server berichtigen ließe;
sonst MUST die Handlung fehlen oder gesperrt mit Grund stehen. „Auftrag aufheben“ steht bei jedem
nicht abgenommenen, nicht aufgehobenen Auftrag bereit.

- „Auftrag aufheben“ MUST rot und abgesetzt stehen.
- Es MUST eine Rückfrage mit Pflichtfeld „Grund“ und dem Bestätigungsknopf „Auftrag aufheben“
  öffnen. Ein Rückgängig-Toast MUST fehlen.
- „Berichtigen“ MUST das Auftragsformular mit dem aktuellen Stand vorbelegt öffnen. Es MUST nur die
  geänderten Felder senden. Der Speicherknopf MUST „Berichtigung speichern“ heißen.
- Ein Speicherfehler MUST im Dialog bzw. Formular stehen, das dabei offen bleibt.
- Ein aufgehobener Auftrag MUST unter „Abgeschlossen“ stehen, mit dem Etikett „Aufgehoben“ im
  neutralen Ton, nicht im Ton eines erledigten Abschlusses, und mit Grund, Zeitpunkt in taktischer
  Zeit und aufhebender Person.

#### Scenario: Erteilen, aufheben, abgeschlossen
- **WHEN** die Einsatzleitung einen Auftrag erteilt, ihn über „Auftrag aufheben“ mit einem Grund
  aufhebt und auf „Abgeschlossen“ wechselt
- **THEN** steht der Auftrag dort mit dem Etikett „Aufgehoben“ und dem Grund

#### Scenario: Beobachter sieht keine Handlung
- **WHEN** ein Beobachter die Auftragsliste öffnet
- **THEN** fehlen „Berichtigen“ und „Auftrag aufheben“

#### Scenario: Quittierter Auftrag
- **WHEN** an einem Auftrag ein Empfänger quittiert hat
- **THEN** ist „Berichtigen“ nicht wählbar, und „Auftrag aufheben“ steht bereit
