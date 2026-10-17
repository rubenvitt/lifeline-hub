# kraefte-abloesung Specification

## Purpose
Die Führung sieht und steuert, wann welche Einheit im Einsatz abgelöst werden muss. Das
umfasst den Rhythmus je Einheit, Abschnitt oder Einsatz, die Schichtmodelle der Organisation,
Vorwarnung und Überfälligkeit, den Vollzug mit Folgeschicht und seine Rücknahme. Jeder Schritt
ist im Einsatztagebuch nachgewiesen.

LLH-1122 hebt das Non-Goal „Die Vorwarnzeit ist fest auf 30 min gesetzt“ aus LFH-635
(`openspec/changes/archive/2026-09-29-lfh-635-fachmodul-abloesung/design.md`, Non-Goals) auf:
die Vorwarnzeit kommt aus dem Schichtmodell des Einsatzes, 30 min sind nur noch die Vorgabe.

## Requirements

### Requirement: Schicht einer Einheit

Das System SHALL je Einheit eines Einsatzes Schichten führen. Eine Schicht trägt Beginn
(Einsatzbeginn der Einheit), Rhythmus in Minuten, die daraus berechnete Fälligkeit
(Beginn + Rhythmus), optional eine geplante ablösende Einheit und einen Status
(`laufend` oder `abgeloest`). Je Einheit MUST höchstens eine Schicht `laufend` sein. Fehlt beim
Anlegen der Beginn, MUST das System das nicht gestrichene Eintreffen der offenen Einsatzperiode
der Einheit aus der Kräfte-Zeitachse übernehmen und ohne ein solches den Zeitpunkt der Anlage.

#### Scenario: Schicht beginnen mit eigenem Rhythmus
- **WHEN** eine Person mit Schreibrecht für Einheit „Florian 1“ eine Schicht mit Beginn 09:30 und Rhythmus 360 min anlegt
- **THEN** entsteht eine laufende Schicht mit Fälligkeit 15:30

#### Scenario: Beginn fehlt, Einheit ist eingetroffen
- **WHEN** um 09:00 eine Schicht ohne Beginn für eine Einheit angelegt wird, deren offene Periode ein Eintreffen um 06:40 trägt
- **THEN** beginnt die Schicht um 06:40

#### Scenario: Beginn fehlt
- **WHEN** eine Schicht ohne Beginn für eine Einheit ohne Eintreffen in einer offenen Periode angelegt wird
- **THEN** gilt der Zeitpunkt der Anlage als Beginn

#### Scenario: Zweite laufende Schicht
- **WHEN** für eine Einheit mit laufender Schicht eine weitere angelegt wird
- **THEN** antwortet das System mit 422 und legt nichts an

#### Scenario: Einheit eines anderen Einsatzes
- **WHEN** die angegebene Einheit nicht zum Einsatz gehört
- **THEN** antwortet das System mit 404

#### Scenario: Ungültiger Rhythmus
- **WHEN** der Rhythmus fehlt und weder der Abschnitt der Einheit noch der Einsatz eine Vorgabe hat, oder der Rhythmus ≤ 0 oder > 7 Tage ist
- **THEN** antwortet das System mit 400

### Requirement: Rangfolge des Rhythmus

Das System SHALL den Rhythmus einer neuen Schicht in dieser Rangfolge bestimmen: ein
eigener Wert der Schicht (`rhythmus_quelle = einheit`), sonst die Vorgabe des Abschnitts ihrer
Einheit (`abschnitt`), sonst die Vorgabe des Einsatzes (`einsatz`). Folgt eine Schicht der
Vorgabe des Einsatzes, MUST das System Fälligkeit und Rhythmus aus deren Schichtmodell rechnen;
bei Wechselzeiten ist der gespeicherte Rhythmus die Dauer von Beginn bis Fälligkeit. Das
Einsatztagebuch MUST beim Beginn die Herkunft „Vorgabe Einsatz“ mit der Bezeichnung des Modells
nennen.

#### Scenario: Einsatzvorgabe greift
- **WHEN** der Einsatz die Vorgabe „Sanitätsdienst“ mit Rhythmus 360 min hat und eine Schicht ohne eigenen Rhythmus für eine Einheit ohne Abschnittsvorgabe um 08:00 beginnt
- **THEN** folgt die Schicht der Vorgabe des Einsatzes und ist um 14:00 fällig
- **AND** das ETB nennt „Rhythmus 6 h (Vorgabe Einsatz «Sanitätsdienst»)“

#### Scenario: Abschnitt vor Einsatz
- **WHEN** der Abschnitt der Einheit eine Vorgabe von 480 min hat und der Einsatz eine von 360 min
- **THEN** folgt die Schicht der Vorgabe des Abschnitts

#### Scenario: Zurück zur Vorgabe ohne jede Vorgabe
- **WHEN** eine Schicht mit eigenem Rhythmus zurück zur Vorgabe soll und weder Abschnitt noch Einsatz eine haben
- **THEN** antwortet das System mit 422

### Requirement: Fälligkeit nach Wechselzeiten

Das System SHALL bei einem Schichtmodell vom Typ `wechselzeiten` die Fälligkeit als den
ersten Wechsel bestimmen, der mindestens die Mindestdauer nach dem Beginn und echt nach dem
Beginn liegt. Die Wechselzeiten MUST als Wanduhrzeit in der wirksamen Zone gelten: die erste
gültige aus der Zone des Einsatzes und der der Organisation, sonst Europe/Berlin. Über eine Zeitumstellung MUST die
echte Dauer zählen; eine Wechselzeit, die es am Umstellungstag nicht gibt, gilt eine Stunde
später, eine doppelte beim ersten Mal. Die Fälligkeit MUST gespeichert werden.

#### Scenario: Wechsel am selben Tag
- **WHEN** eine Schicht um 13:42 beginnt und das Modell Wechsel um 06:00 und 18:00 mit 4 h Mindestdauer vorgibt
- **THEN** ist sie um 18:00 fällig

#### Scenario: Wechsel am Folgetag
- **WHEN** dieselbe Schicht um 15:00 beginnt
- **THEN** ist sie um 06:00 am Folgetag fällig

#### Scenario: Zeitumstellung Ende März
- **WHEN** eine Schicht am 28.03.2026 um 18:00 (Europe/Berlin) beginnt
- **THEN** ist sie am 29.03.2026 um 06:00 Sommerzeit fällig, nach elf echten Stunden

#### Scenario: Zone des Einsatzes vor der Organisation
- **WHEN** die Organisation die Zone UTC hat und der Einsatz Europe/Berlin
- **THEN** gelten die Wechselzeiten in Europe/Berlin

### Requirement: Schichtmodelle der Organisation

Das System SHALL je Organisation Schichtmodelle als Stammdaten führen: Bezeichnung, Typ
(`rhythmus` mit Rhythmus in Minuten oder `wechselzeiten` mit Uhrzeiten und Mindestdauer),
Vorwarnung (Vorgabe 30 min) und Planungsvorlauf (Vorgabe 120 min). Höchstens ein Modell MUST die
Vorgabe der Organisation sein. Lesen darf jedes Mitglied der Organisation, anlegen, ändern und
löschen nur ein Admin; jede Änderung meldet das Org-Ereignis `stammdaten`. Die Bezeichnung MUST je
Organisation ohne Unterschied von Groß- und Kleinschreibung eindeutig sein. Ein Modell der
Demo-Daten MUST `ist_demo` melden.

#### Scenario: Zweite Vorgabe
- **WHEN** ein Admin ein zweites Modell als Vorgabe der Organisation anlegt oder setzt
- **THEN** antwortet das System mit 409, und die bisherige Vorgabe bleibt

#### Scenario: Gleiche Bezeichnung
- **WHEN** ein Admin ein Modell „HOCHWASSER“ anlegt und es „Hochwasser“ schon gibt
- **THEN** antwortet das System mit 409

#### Scenario: Feld des anderen Typs
- **WHEN** ein Modell vom Typ `rhythmus` eine Mindestdauer trägt
- **THEN** antwortet das System mit 422; fehlt der Rhythmus, mit 400

#### Scenario: Kein Admin
- **WHEN** eine Person ohne Admin-Rolle ein Modell anlegt
- **THEN** antwortet das System mit 403

### Requirement: Vorgabe des Einsatzes

Das System SHALL beim Anlegen eines Einsatzes die Vorgabe der Organisation als Kopie zur
Vorgabe des Einsatzes machen. Hat die Organisation keine Vorgabe, MUST der Einsatz ohne Vorgabe
bleiben. Eine spätere Änderung oder das Löschen des Modells in den Stammdaten MUST die Kopie und
damit laufende Fälligkeiten unverändert lassen. Die Vorgabe des Einsatzes MUST mit den Rechten der
Abschnittsvorgabe lesbar und änderbar sein: als Kopie eines Modells der eigenen Organisation, mit
eigenen Werten oder entfernt. Ändert sie sich, MUST das System Rhythmus, Fälligkeit und Fristen
aller laufenden Schichten mit Quelle `einsatz` neu setzen und die Vorwarn-Fristen aller laufenden
Schichten auf die neue Vorwarnzeit legen. Eine Fälligkeitsfrist MUST nur neu gesetzt werden,
wenn sich die Fälligkeit ändert, damit eine überfällige Schicht nicht ein zweites Mal „fällig“
meldet. Eine entfernte Vorgabe lässt Rhythmus und Fälligkeit stehen. Jede Änderung MUST als ETB-Eintrag vom Typ Entscheidung festgehalten werden.

#### Scenario: Anlage übernimmt die Org-Vorgabe
- **WHEN** die Organisation die Vorgabe „12-h-Schicht“ führt und ein Einsatz angelegt wird
- **THEN** hat der Einsatz eine Kopie von „12-h-Schicht“ als Vorgabe

#### Scenario: Gelöschtes Modell
- **WHEN** das Modell danach in den Stammdaten geändert und gelöscht wird
- **THEN** ist die Vorgabe des Einsatzes unverändert

#### Scenario: Einsatzvorgabe verkürzt
- **WHEN** die Vorgabe des Einsatzes von 360 auf 240 min mit 45 min Vorwarnung gesetzt wird und eine laufende Schicht ihr folgt
- **THEN** ist diese Schicht 120 min früher fällig, ihre Fristen stehen auf der neuen Fälligkeit und 45 min davor
- **AND** Schichten mit eigenem Rhythmus oder nach der Abschnittsvorgabe behalten ihre Fälligkeit

#### Scenario: Nur die Vorwarnung ändert sich
- **WHEN** eine Schicht seit 10:30 überfällig ist, „fällig“ schon gemeldet hat und um 10:33 eine Vorgabe mit 45 min Vorwarnung gesetzt wird
- **THEN** meldet der Scheduler für diese Schicht kein zweites „fällig“

#### Scenario: Weder Modell noch Werte
- **WHEN** die Vorgabe ohne `schichtmodell_id` und ohne `schichtmodell` gesetzt werden soll
- **THEN** antwortet das System mit 400; mit beiden Angaben mit 422; mit einem fremden Modell mit 404

### Requirement: Rhythmus-Vorgabe am Abschnitt

Das System SHALL am Einsatzabschnitt eine optionale Rhythmus-Vorgabe führen. Eine neue
Schicht ohne eigenen Rhythmus MUST die Vorgabe des Abschnitts ihrer Einheit übernehmen und
ihr folgen. Ändert sich die Vorgabe, MUST das System Rhythmus und Fälligkeit aller laufenden
Schichten neu berechnen, die ihr folgen. Schichten mit eigenem Rhythmus bleiben unverändert.
Jede Änderung der Vorgabe MUST als ETB-Eintrag vom Typ Entscheidung festgehalten werden.

#### Scenario: Vorgabe verkürzt
- **WHEN** die Vorgabe von Abschnitt „Deichwache Nord“ von 480 auf 360 min gesetzt wird und dort zwei laufende Schichten der Vorgabe folgen
- **THEN** sind beide Schichten 120 min früher fällig
- **AND** das ETB enthält einen Entscheidungseintrag, der Abschnitt und neuen Rhythmus nennt

#### Scenario: Eigener Rhythmus bleibt
- **WHEN** die Vorgabe geändert wird und eine Schicht im Abschnitt einen eigenen Rhythmus trägt
- **THEN** bleibt deren Fälligkeit unverändert

#### Scenario: Vorgabe entfernen
- **WHEN** die Vorgabe entfernt wird
- **THEN** behalten laufende Schichten ihren zuletzt gültigen Rhythmus

### Requirement: Schicht bearbeiten

Das System SHALL an einer laufenden Schicht Beginn, Rhythmus (eigener Wert oder zurück zur
Vorgabe des Abschnitts, sonst des Einsatzes) und geplante ablösende Einheit änderbar machen.
Eine Änderung von Beginn
oder Rhythmus MUST die Fälligkeit und die zugehörigen Fristen neu setzen. Eine abgelöste
Schicht MUST NOT änderbar sein.

#### Scenario: Ablösende Einheit planen
- **WHEN** an der laufenden Schicht von „Florian 1“ die Einheit „Florian 2“ als ablösende Einheit gesetzt wird
- **THEN** zeigt die Schicht „Florian 2“ als geplante Ablösung

#### Scenario: Ablösende Einheit ist dieselbe Einheit
- **WHEN** die Einheit der Schicht als ihre eigene ablösende Einheit gesetzt wird
- **THEN** antwortet das System mit 422

#### Scenario: Abgelöste Schicht ändern
- **WHEN** eine abgelöste Schicht geändert werden soll
- **THEN** antwortet das System mit 422

### Requirement: Fälligkeit, Vorwarnung und Überfälligkeit

Das System SHALL eine laufende Schicht als `vorwarnung` einstufen, wenn ihre Fälligkeit
höchstens die Vorwarnzeit entfernt ist, und als `ueberfaellig`, wenn sie erreicht oder
überschritten ist. Andernfalls ist sie `planmaessig`. Die Vorwarnzeit MUST aus dem
Schichtmodell des Einsatzes kommen, ohne eines gilt 30 min; jede Schicht MUST sie als
`vorwarnung_minuten` melden. Die Einstufung MUST bei jedem Lesen gegen die aktuelle Zeit
berechnet werden und darf nicht davon abhängen, ob ein Hintergrundlauf stattgefunden hat.

#### Scenario: Überfällig
- **WHEN** eine laufende Schicht um 15:30 fällig ist und um 15:31 gelesen wird
- **THEN** trägt sie die Einstufung `ueberfaellig`

#### Scenario: Vorwarnzeit
- **WHEN** dieselbe Schicht um 15:05 gelesen wird
- **THEN** trägt sie die Einstufung `vorwarnung`

#### Scenario: Vorwarnung aus dem Schichtmodell
- **WHEN** das Schichtmodell des Einsatzes 45 min Vorwarnung vorgibt und die Schicht um 14:45 gelesen wird
- **THEN** trägt sie die Einstufung `vorwarnung` und meldet `vorwarnung_minuten: 45`

### Requirement: Kopplung an den Erinnerungs-Scheduler

Das System SHALL für jede laufende Schicht eine offene Auto-Frist zur Fälligkeit führen und,
solange die Vorwarnzeit noch in der Zukunft liegt, eine zweite um die Vorwarnzeit vor
Fälligkeit.
Beim Anlegen einer Schicht und bei Änderungen von Beginn oder Rhythmus MUST das System diese
Fristen anlegen oder verschieben. Bei Vollzug MUST es sie schließen. Erreicht der Scheduler
eine dieser Fristen, MUST er genau einmal ein Live-Ereignis an alle Leser des Moduls
Ablösung senden, das die Schicht und die Art (`vorwarnung` oder `faellig`) nennt.

#### Scenario: Fristen beim Anlegen
- **WHEN** um 09:30 eine Schicht mit Fälligkeit 15:30 angelegt wird
- **THEN** gibt es für sie je eine offene Frist zu 15:00 und zu 15:30

#### Scenario: Vorwarnzeit schon vorbei
- **WHEN** eine Schicht angelegt wird, deren Fälligkeit weniger als 30 min entfernt ist
- **THEN** wird nur die Frist zur Fälligkeit angelegt

#### Scenario: Frist wandert mit
- **WHEN** der Rhythmus einer laufenden Schicht geändert wird
- **THEN** stehen ihre offenen Fristen auf den neuen Zeitpunkten, und eine schon ausgelöste Frist wird zum neuen Zeitpunkt erneut ausgelöst

#### Scenario: Einmaliges Auslösen
- **WHEN** der Scheduler die Fälligkeit einer Schicht erreicht und danach weiterläuft
- **THEN** geht genau ein Live-Ereignis `abloesung` mit Art `faellig` an die Leser des Moduls, und es wiederholt sich nicht

#### Scenario: Einheit wird aufgelöst
- **WHEN** eine Einheit mit laufender Schicht aufgelöst wird
- **THEN** sind Schicht und offene Fristen danach nicht mehr offen, und der Scheduler löst für sie nichts mehr aus

### Requirement: Vollzug mit Folgeschicht

Das System SHALL eine laufende Schicht mit Zeitpunkt (Vorgabe: jetzt) und optionaler
ablösender Einheit vollziehen. Beim Vollzug MUST die Schicht `abgeloest` werden, ihre offenen
Fristen MUST geschlossen werden, und ein ETB-Eintrag MUST Einheit, ablösende Einheit und
Zeitpunkt nennen. Ist eine ablösende Einheit angegeben, MUST für sie in derselben
Transaktion eine laufende Folgeschicht mit Beginn = Vollzugszeitpunkt und dem Rhythmus der
abgelösten Schicht entstehen, samt eigener Fristen; folgt die abgelöste Schicht der Vorgabe des
Einsatzes, rechnet deren Schichtmodell die Folgeschicht ab dem Vollzug. Hat die ablösende
Einheit schon eine
laufende Schicht, MUST der Vollzug mit 422 scheitern und nichts ändern.

#### Scenario: Vollzug mit ablösender Einheit
- **WHEN** die Schicht von „Florian 1“ (Rhythmus 360 min) um 15:40 durch „Florian 2“ vollzogen wird
- **THEN** ist die Schicht von „Florian 1“ abgelöst
- **AND** „Florian 2“ hat eine laufende Schicht mit Beginn 15:40 und Fälligkeit 21:40
- **AND** das ETB enthält einen Eintrag „Ablösung vollzogen“ mit beiden Einheiten und der Uhrzeit

#### Scenario: Vollzug ohne ablösende Einheit
- **WHEN** eine Schicht ohne ablösende Einheit vollzogen wird
- **THEN** ist sie abgelöst, und es entsteht keine Folgeschicht

#### Scenario: Ablösende Einheit hat schon eine Schicht
- **WHEN** die ablösende Einheit bereits eine laufende Schicht hat
- **THEN** antwortet das System mit 422, und die ursprüngliche Schicht bleibt laufend

#### Scenario: Doppelter Vollzug
- **WHEN** eine bereits abgelöste Schicht erneut vollzogen werden soll
- **THEN** antwortet das System mit 422

### Requirement: Rücknahme eines Vollzugs

Das System SHALL einen Vollzug zurücknehmen, solange die daraus entstandene Folgeschicht
unberührt ist, also noch laufend und ohne eigenen Vollzug. Bei der Rücknahme MUST die
Folgeschicht samt ihrer Fristen entfernt werden, die abgelöste Schicht MUST wieder laufend
sein, ihre Fristen MUST wieder offen sein, ohne dass eine schon erfolgte Auslösung
wiederholt wird. Die Vorwarn-Frist MUST dabei der aktuellen Vorwarnzeit folgen; folgt die
Schicht der Vorgabe des Einsatzes und rechnet deren Regel inzwischen anders, MUST die neue
Fälligkeit samt neuer Fristen gelten. Ein ETB-Eintrag vom Typ Berichtigung MUST auf den Vollzugseintrag
verweisen.

#### Scenario: Rücknahme direkt nach Vollzug
- **WHEN** ein Vollzug von „Florian 1“ durch „Florian 2“ zurückgenommen wird
- **THEN** ist die Schicht von „Florian 1“ wieder laufend mit ihrer alten Fälligkeit
- **AND** „Florian 2“ hat keine laufende Schicht mehr
- **AND** das ETB enthält eine Berichtigung zum Vollzugseintrag

#### Scenario: Folgeschicht schon vollzogen
- **WHEN** die Folgeschicht ihrerseits schon vollzogen ist
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Schicht ohne Vollzug
- **WHEN** eine laufende Schicht zurückgenommen werden soll
- **THEN** antwortet das System mit 422

### Requirement: Rechte und Modulsichtbarkeit

Lesende Endpunkte MUST Lesezugriff auf den Einsatz und das Modul Ablösung verlangen,
schreibende Endpunkte Schreibrecht im Einsatz, einen aktiven Einsatz und das Modul. Ist das
Modul im Einsatz ausgeblendet, MUST das System 403 liefern. Live-Ereignisse `abloesung` MUST
nur Abonnenten mit Zugriff auf das Modul erreichen.

#### Scenario: Beobachter liest
- **WHEN** eine Person ohne Schreibrecht die Schichten abruft
- **THEN** erhält sie die Liste

#### Scenario: Beobachter vollzieht
- **WHEN** eine Person ohne Schreibrecht einen Vollzug absendet
- **THEN** antwortet das System mit 403

#### Scenario: Modul ausgeblendet
- **WHEN** das Modul Ablösung im Einsatz ausgeblendet ist und die Schichten abgerufen werden
- **THEN** antwortet das System mit 403

### Requirement: Anzeige im Modul

Die Seite des Moduls SHALL die laufenden Schichten nach Fälligkeit geordnet zeigen, jeweils
mit Einheit, Abschnitt, Beginn, Rhythmus (mit Kennzeichnung Vorgabe oder eigener Wert),
Fälligkeit als Uhrzeit, Einstufung als Wort und Farbe sowie der geplanten ablösenden
Einheit. Die Einstufung MUST einen zweiten Kanal neben der Farbe tragen (Wort), und nichts
davon darf blinken. Ohne Schreibrecht MUST die Seite den Grund nennen und die Aktionen
gesperrt statt entfernt zeigen. Abgelöste Schichten MUST in einer eigenen Ansicht
nachlesbar sein.

#### Scenario: Überfällige Schicht in der Liste
- **WHEN** eine Schicht überfällig ist
- **THEN** zeigt ihre Zeile die Fälligkeitsuhrzeit, das Wort „überfällig“ und die Alarmfarbe am Rand, ohne Animation

#### Scenario: Vollzug mit Rückgängig
- **WHEN** eine Person eine Ablösung über den Dialog vollzieht
- **THEN** zeigt die Seite einen Hinweis mit der Aktion „Rückgängig“, die die Rücknahme auslöst

### Requirement: Kartenhöhe unabhängig von Uhrzeit und fremder Rhythmusänderung

Die Karte einer Schicht SHALL die Fälligkeit in einer Zeitspalte zeigen, die das breiteste
Zeitformat (Tag und Uhrzeit) fasst, sodass Tageszeit und Tageswechsel weder Spaltenbreite noch
Umbruch ändern. Der Rhythmus MUST in einer eigenen, einzeiligen Zeile stehen, als Dauer mit der
Quelle „eigen“, „Vorgabe“ (des Abschnitts) oder „Vorgabe Einsatz“; reicht der Platz nicht, kürzt
sie nur das Quellenwort mit „…“. Ändert eine andere Person den Rhythmus einer gezeigten
Schicht, MUST die Karte ihre Höhe behalten, solange die Zeile mindestens 226 px Platz für Text
hat.

#### Scenario: Fremde Rhythmusänderung kurz vor Mitternacht, mobil
- **WHEN** um 23:40 (Anzeigezone Europe/Berlin) auf 390 px Breite in der Dichte `komfortabel` drei Schichten mit 6 h gezeigt werden und eine andere Person den Rhythmus der mittleren auf 30 min setzt
- **THEN** behalten alle drei Karten ihre Oberkante (Abweichung höchstens 0,5 px), und die mittlere Karte zeigt ihre neue Einstufung

#### Scenario: Gleiche Lage am Tag und in der Nacht
- **WHEN** dieselbe Liste einmal um 12:00 und einmal um 23:40 gezeigt wird
- **THEN** ist die Zeitspalte der Karten in beiden Fällen gleich breit

#### Scenario: Längster zulässiger Rhythmus bleibt einzeilig
- **WHEN** eine Schicht einen Rhythmus von 167 h 59 min als Vorgabe des Einsatzes trägt und die Karte auf 390 px Breite in der Dichte `komfortabel` oder `handschuh` steht
- **THEN** steht die Zeile „Rhythmus 167:59 h (Vorgabe Einsatz)“ einzeilig, der Wert „Rhythmus 167:59 h“ ganz sichtbar und der ganze Text im Titel

### Requirement: Schichtmodelle in der Verwaltung

Die Verwaltung SHALL unter „Stammdaten“ einen Bereich „Schichtmodelle“ führen: eine Tabelle mit
Bezeichnung, Regel, Vorwarnung und Planungsvorlauf, Vorgabe- und Demo-Marke. Ein Admin MUST Modelle anlegen, ändern, nach Rückfrage löschen und mit
einem Handgriff zur Vorgabe der Organisation machen oder deren Vorgabe aufheben können. Ohne
Admin-Recht MUST der Bereich den Grund nennen und das Anlegen gesperrt zeigen. Er MUST über das
Org-Ereignis `stammdaten` live bleiben.

#### Scenario: Vorgabe der Organisation wechseln
- **WHEN** „Sanitätsdienst“ die Vorgabe der Organisation ist und ein Admin bei „Hochwasser“ „Als Vorgabe setzen“ wählt
- **THEN** sendet die Oberfläche zuerst „Sanitätsdienst“ ohne Vorgabe und dann „Hochwasser“ als Vorgabe, jeweils mit dem ganzen Satz

#### Scenario: Zweiter Schritt scheitert
- **WHEN** beim Wechsel das Setzen der neuen Vorgabe abgelehnt wird
- **THEN** stellt die Oberfläche die bisherige Vorgabe wieder her und nennt den Grund

### Requirement: Schichtmodell in der Einsatzanlage

Der Dialog „Neuen Einsatz anlegen“ SHALL die Vorgabe der Organisation als Zeile
„Schichtmodell: <Bezeichnung> (Vorgabe)“ nennen, ohne eigenes Feld. Ohne Vorgabe der
Organisation MUST die Zeile fehlen.

#### Scenario: Zeile in der Einsatzanlage
- **WHEN** die Organisation „12-h-Schicht“ als Vorgabe führt und jemand „Neuen Einsatz anlegen“ öffnet
- **THEN** steht im Dialog „Schichtmodell: 12-h-Schicht (Vorgabe)“, und der Dialog hat weiter fünf Felder

### Requirement: Vorgabe des Einsatzes in den Einstellungen

Die Einsatz-Einstellungen SHALL einen Reiter „Ablösung“ führen, der die Vorgabe des Einsatzes
zeigt (Bezeichnung, Regel, Vorwarnung, Planungsvorlauf, laufende Schichten). Mit den Rechten der
Abschnittsvorgabe MUST er ein Modell der Organisation übernehmen, eigene Werte setzen und die
Vorgabe entfernen lassen; Entfernen MUST über „Rückgängig“ mit den alten Werten umkehrbar sein.
Ohne Freigabe des Moduls Ablösung MUST der Reiter das sagen, statt die Vorgabe abzufragen.

#### Scenario: Modell übernehmen
- **WHEN** die Einsatzleitung im Reiter „Ablösung“ „Sanitätsdienst“ wählt und „Übernehmen“ wählt
- **THEN** sendet die Oberfläche `schichtmodell_id` und zeigt danach „Rhythmus 6 h“

#### Scenario: Entfernen und zurücknehmen
- **WHEN** die Einsatzleitung „Vorgabe entfernen“ wählt und danach im Hinweis „Rückgängig“
- **THEN** ist die alte Vorgabe mit denselben Werten wieder gesetzt

### Requirement: Dauern und Einsatzvorgabe auf der Seite Ablösung

Dauern SHALL als „8 h“, „7:30 h“ oder „45 min“ erscheinen und so vorbelegt werden, nie mit
Dezimalpunkt; Wechselzeiten taktisch („0600/1800“). Die Seite Ablösung MUST die Vorgabe des
Einsatzes zeigen und sie in „Schicht beginnen“ und „Rhythmus ändern“ als letzte Stufe der
Rangfolge nennen: ohne Vorgabe des Abschnitts als Platzhalter, und das Rhythmusfeld darf leer
bleiben. Die Einstufung im Client MUST mit `vorwarnung_minuten` der Schicht rechnen.

#### Scenario: Einsatzvorgabe als Platzhalter
- **WHEN** der Einsatz die Vorgabe „Sanitätsdienst“ mit 12 h hat und eine Schicht für eine Einheit ohne Abschnittsvorgabe beginnen soll
- **THEN** zeigt das Rhythmusfeld „12 h (Vorgabe Einsatz)“, ist kein Pflichtfeld und sendet leer keinen Rhythmus

#### Scenario: Dauer statt Dezimalzahl
- **WHEN** eine Schicht einen eigenen Rhythmus von 450 min hat und jemand „Rhythmus ändern“ öffnet
- **THEN** steht im Feld „7:30 h“

#### Scenario: Eingabe einer Dauer
- **WHEN** jemand „8“, „7:30“, „7,5“ oder „90 min“ einträgt
- **THEN** gelten 480, 450, 450 bzw. 90 Minuten, und Unlesbares lehnt das Feld ab, ohne zu senden

#### Scenario: Vorwarnung aus der Schicht
- **WHEN** eine laufende Schicht in 50 min fällig ist und `vorwarnung_minuten: 60` meldet
- **THEN** zählt der Modulzähler sie als fällig, ohne neuen Abruf

### Requirement: Hinweis in der AlarmZentrale

Die Oberfläche SHALL zur Vorwarnung und zur Fälligkeit einer Schicht genau einen Toast zeigen,
mit Einheit, Uhrzeit und einem Sprung zur Seite Ablösung. Er kommt als Benachrichtigung
(`abloesung_vorwarnung` als Hinweis, `abloesung_faellig` als Alarm, Spec `benachrichtigungen`)
an alle mit dem Modul Ablösung; das Live-Ereignis `abloesung` frischt nur die Liste auf. Der
Toast MUST dem gemeinsamen Budget der Benachrichtigungen unterliegen (höchstens drei sichtbar, der
Rest gebündelt) und quittierbar sein. Dieselbe Fälligkeit darf nicht zusätzlich als allgemeine
Erinnerung alarmieren.

#### Scenario: Fälligkeit erreicht
- **WHEN** die Schicht von „Florian 1“ um 15:30 fällig wird
- **THEN** erscheint der Alarm „Ablösung fällig“ mit „Florian 1, 15:30“ und Sprung zur Seite Ablösung

#### Scenario: Kein Doppelalarm
- **WHEN** zur selben Fälligkeit auch eine Erinnerung mit Bezug Ablösung fällig wird
- **THEN** entsteht dafür keine zweite Benachrichtigung

### Requirement: Marke im Überblick und Modulzähler

Der Überblick SHALL laufende Schichten als Marken unter „Nächste Marken“ führen. Schichten
desselben Abschnitts mit gleicher Fälligkeit (minutengenau) MUST zu einer Marke
„Ablösung <Abschnitt>, <n> Einheiten“ zusammengefasst werden, eine einzelne Schicht als
„Ablösung <Einheit>“. Das Modulpanel SHALL am Modul Ablösung die Zahl der Schichten mit
Einstufung `vorwarnung` oder `ueberfaellig` zeigen. Die Marken und der Zähler MUST nur
erscheinen, wenn das Modul für die Person sichtbar ist.

#### Scenario: Zusammengefasste Marke
- **WHEN** zwei Einheiten im Abschnitt „Deichwache Nord“ beide um 15:30 fällig sind
- **THEN** zeigt der Überblick eine Marke „15:30 Ablösung Deichwache Nord, 2 Einheiten“

#### Scenario: Zähler
- **WHEN** eine Schicht überfällig ist, eine in 20 min fällig und eine in 3 h
- **THEN** zeigt das Modulpanel am Modul Ablösung die Zahl 2

### Requirement: Auflösen behält abgelöste Schichten

Wird eine Einheit aufgelöst, SHALL das System ihre laufende Schicht samt offener Fristen
entfernen und ihre abgelösten Schichten samt Vollzug behalten. Verweist eine Schicht einer
anderen Einheit auf die aufgelöste als ablösende Einheit, MUST dieser Verweis geleert werden.

#### Scenario: Historie bleibt
- **WHEN** eine Einheit mit zwei abgelösten und einer laufenden Schicht aufgelöst wird
- **THEN** zeigt die Ablösung die beiden abgelösten Schichten weiter, die laufende nicht mehr
