# Spec Delta

## Purpose

Die Führung sieht je Einheit und je Person im Einsatz, wann sie alarmiert wurde, eingetroffen
ist, abgelöst oder entlassen wurde, und daraus die laufende Einsatzdauer, die Gesamteinsatzzeit
und die Ruhezeit. Die Zeitpunkte entstehen überwiegend aus Statuswechseln, die ohnehin gepflegt
werden.

## ADDED Requirements

### Requirement: Ereignisse der Zeitachse

Das System SHALL je Einheit und je Person eines Einsatzes ein Ereignisprotokoll führen. Ein
Ereignis trägt Art (`alarmierung`, `eintreffen`, `abloesung` oder `entlassung`), Zeitpunkt,
Quelle (`status`, `einheit`, `abloesung` oder `nachtrag`), optional eine Notiz, die erfassende
Person und den Erfassungszeitpunkt. Das Protokoll MUST append-only sein: Ein Ereignis wird nie
geändert oder gelöscht, nur gestrichen (siehe Streichung). Die Reihenfolge der Ereignisse MUST
sich nach ihrem Zeitpunkt richten, nicht nach dem Erfassungszeitpunkt.

#### Scenario: Ereignis bleibt nach Streichung lesbar
- **WHEN** ein Ereignis „eintreffen 06:40“ gestrichen wird
- **THEN** liefert die Zeitachse es weiter, gekennzeichnet als gestrichen mit Zeitpunkt und Person der Streichung

#### Scenario: Nachtrag reiht sich nach Zeit ein
- **WHEN** um 09:00 ein Eintreffen für 06:40 nachgetragen wird und bereits eine Alarmierung um 06:10 besteht
- **THEN** steht das Eintreffen in der Zeitachse nach der Alarmierung

### Requirement: Einsatzperioden

Das System SHALL die nicht gestrichenen Ereignisse einer Kraft zu Einsatzperioden ordnen. Eine
Periode MUST mit einer Alarmierung oder einem Eintreffen beginnen, wenn keine Periode offen ist,
und mit einer Ablösung oder Entlassung enden. Innerhalb einer offenen Periode MUST es höchstens
eine Alarmierung und höchstens ein Eintreffen geben, und eine Alarmierung MUST NOT nach dem
Eintreffen derselben Periode liegen. Ein Ende ohne offene Periode MUST NOT entstehen.

#### Scenario: Zwei Perioden
- **WHEN** eine Einheit die Ereignisse Alarmierung 06:10, Eintreffen 06:40, Ablösung 14:40, Alarmierung 22:00 trägt
- **THEN** hat sie eine beendete Periode 06:10–14:40 und eine offene Periode ab 22:00

#### Scenario: Eintreffen ohne Alarmierung
- **WHEN** für eine Person ohne offene Periode ein Eintreffen um 07:00 entsteht
- **THEN** beginnt ihre Periode um 07:00 mit dem Eintreffen als Anker

### Requirement: Zeitachsen-Marke am Status-Katalog

Das System SHALL an jedem Eintrag des Fahrzeug- und des Personal-Status-Katalogs eine optionale
Zeitachsen-Marke führen (`alarmierung`, `eintreffen` oder `entlassung`). Nur eine Person mit
Verwaltungsrecht für die Stammdaten MUST sie setzen können. Bestehende Katalogeinträge MUST ohne
Marke bleiben. Die Startlisten neuer Organisationen MUST Marken nur dort tragen, wo der Status
die Art eindeutig benennt: Personal „alarmiert“ → Alarmierung, „im Einsatz“ → Eintreffen,
„abgemeldet“ → Entlassung.

#### Scenario: Unbekannte Marke
- **WHEN** ein Katalogeintrag mit der Marke „pause“ gespeichert wird
- **THEN** antwortet das System mit 400

#### Scenario: Bestand ohne Marke
- **WHEN** die Migration auf eine Organisation mit bestehendem Katalog trifft
- **THEN** trägt kein bestehender Eintrag eine Marke

### Requirement: Ereignis aus einem Statuswechsel

Wechselt eine Person auf einen Status mit Marke, auch schon bei der Disposition, SHALL das
System in derselben Transaktion ein Ereignis dieser Art für die Person schreiben (Quelle
`status`, Zeitpunkt = Wechsel). Wechselt ein Fahrzeug einer Einheit auf einen Status mit Marke
`alarmierung` oder `eintreffen`, MUST die Einheit das Ereignis bekommen, sofern ihre offene
Periode diese Art noch nicht trägt; das erste Fahrzeug zählt. Die Marke `entlassung` MUST die
Einheit erst dann entlassen, wenn danach alle ihre Fahrzeuge einen Status mit dieser Marke
tragen. Ein Handstatus einer Einheit ohne Fahrzeug MUST wie ein Wechsel an der Einheit selbst
wirken. Würde das Ereignis die Perioden-Regeln verletzen, MUST das System es auslassen, und der
Statuswechsel MUST trotzdem gelingen. Ein Statuswechsel ohne Marke MUST kein Ereignis schreiben.

#### Scenario: Person wird alarmiert
- **WHEN** eine Person um 06:10 auf den Status „alarmiert“ mit Marke Alarmierung gesetzt wird
- **THEN** trägt ihre Zeitachse eine Alarmierung um 06:10 mit Quelle `status`

#### Scenario: Erstes Fahrzeug trifft ein
- **WHEN** das erste von zwei Fahrzeugen einer Einheit um 06:40 auf einen Status mit Marke Eintreffen wechselt und das zweite um 06:55
- **THEN** trägt die Einheit genau ein Eintreffen, um 06:40

#### Scenario: Entlassung erst mit dem letzten Fahrzeug
- **WHEN** von zwei Fahrzeugen einer Einheit das erste auf einen Status mit Marke Entlassung wechselt
- **THEN** bleibt die Periode der Einheit offen, und sie endet erst, wenn auch das zweite wechselt

#### Scenario: Unpassendes Ereignis bricht den Status nicht
- **WHEN** eine Person mit offener Periode, die schon eingetroffen ist, auf „alarmiert“ zurückgesetzt wird
- **THEN** gelingt der Statuswechsel, und die Zeitachse bekommt keine zweite Alarmierung

#### Scenario: Status ohne Marke
- **WHEN** eine Person auf „Pause“ ohne Marke wechselt
- **THEN** entsteht kein Ereignis

### Requirement: Fan-out von der Einheit auf ihre Personen

Entsteht an einer Einheit ein Ereignis, SHALL das System in derselben Transaktion für jede
Person, die der Einheit in diesem Moment zugeordnet ist, ein Ereignis derselben Art und
desselben Zeitpunkts schreiben, mit Quelle `einheit` und Verweis auf das Ereignis der Einheit.
Maßgeblich ist die Zuordnung beim Schreiben, nicht zum Zeitpunkt des Ereignisses: eine
Zuordnungshistorie gibt es nicht, ein Nachtrag in die Vergangenheit erreicht also die Personen,
die beim Nachtrag zugeordnet sind. Für eine Person, deren Perioden-Regeln das Ereignis verletzen
würde, MUST es ausgelassen werden. Eine Person, die erst nach dem Schreiben zugeordnet wird, MUST
keine früheren Ereignisse der Einheit erben.

#### Scenario: Einheit trifft ein
- **WHEN** die Einheit „Florian 1“ mit drei zugeordneten Personen um 06:40 eintrifft
- **THEN** tragen alle drei ein Eintreffen um 06:40 mit Quelle `einheit`

#### Scenario: Person schon eingetroffen
- **WHEN** eine der drei Personen bereits um 06:30 ein eigenes Eintreffen trägt
- **THEN** bekommt sie kein zweites, die beiden anderen bekommen es

#### Scenario: Nachträglich zugeordnet
- **WHEN** eine Person der Einheit erst um 08:00 zugeordnet wird
- **THEN** trägt sie das Eintreffen der Einheit von 06:40 nicht

### Requirement: Nachtrag von Hand

Das System SHALL an einer Einheit oder Person ein Ereignis mit Art, Zeitpunkt und optionaler
Notiz von Hand erfassen lassen (Quelle `nachtrag`). Art und Zeitpunkt sind Pflicht; fehlt eines
oder ist die Art unbekannt, MUST das System mit 400 antworten. Ein Zeitpunkt in der Zukunft oder
ein Ereignis, das die Perioden-Regeln verletzt, MUST mit 422 scheitern und nichts schreiben. Die
Art `abloesung` MUST nicht nachgetragen werden können (400), sie entsteht nur aus dem Vollzug.
Ein Nachtrag an einer Einheit MUST den Fan-out auslösen. Jeder Nachtrag MUST einen
System-ETB-Eintrag schreiben, der Kraft, Art, Zeitpunkt und „nachgetragen“ nennt.

#### Scenario: Eintreffen nachtragen
- **WHEN** um 09:00 für „Florian 1“ ein Eintreffen um 06:40 nachgetragen wird
- **THEN** trägt die Einheit das Eintreffen mit Quelle `nachtrag`, und das ETB nennt „Florian 1 eingetroffen 06:40 (nachgetragen)“

#### Scenario: Zukunft
- **WHEN** ein Eintreffen für eine Uhrzeit in einer Stunde nachgetragen wird
- **THEN** antwortet das System mit 422

#### Scenario: Doppeltes Eintreffen
- **WHEN** eine Einheit mit Eintreffen in der offenen Periode ein zweites Eintreffen nachgetragen bekommt
- **THEN** antwortet das System mit 422 und schreibt nichts

#### Scenario: Kraft eines anderen Einsatzes
- **WHEN** die Einheit oder Person nicht zum Einsatz gehört
- **THEN** antwortet das System mit 404

### Requirement: Streichung

Das System SHALL ein nicht gestrichenes Ereignis mit Pflichtgrund streichen lassen. Die
Streichung eines Einheit-Ereignisses MUST in derselben Transaktion alle noch nicht gestrichenen
Ereignisse streichen, die per Fan-out daraus entstanden sind. Ein Ereignis der Art `abloesung`,
auch seine Fan-out-Kopie an einer Person, MUST sich nur über die Rücknahme des Vollzugs streichen
lassen (422). Jede Streichung von Hand MUST einen System-ETB-Eintrag schreiben, der Kraft, Art,
Zeitpunkt und Grund nennt; die Streichung durch die Rücknahme weist die Berichtigung des Vollzugs
nach. Führt eine Streichung bei der Kraft oder einer betroffenen Person zu einer Ereignisfolge,
die die Perioden-Regeln verletzt, MUST sie mit 422 scheitern und die Person nennen.

#### Scenario: Falsches Eintreffen streichen
- **WHEN** das Eintreffen von „Florian 1“ um 06:40 mit Grund „Zeit verwechselt“ gestrichen wird
- **THEN** sind es und die drei daraus mitgeschriebenen Personen-Ereignisse gestrichen, und das ETB nennt den Grund

#### Scenario: Grund fehlt
- **WHEN** eine Streichung ohne Grund abgeschickt wird
- **THEN** antwortet das System mit 400

#### Scenario: Ablösung an der Person
- **WHEN** die Fan-out-Kopie einer Ablösung an einer Person direkt gestrichen werden soll
- **THEN** antwortet das System mit 422

#### Scenario: Doppelt gestrichen
- **WHEN** ein bereits gestrichenes Ereignis erneut gestrichen werden soll
- **THEN** antwortet das System mit 422

### Requirement: Kopplung an die Ablösung

Vollzieht das System eine Ablösungsschicht einer Einheit, SHALL es in derselben Transaktion ein
Ereignis `abloesung` zum Vollzugszeitpunkt für diese Einheit schreiben (Quelle `abloesung`),
samt Fan-out, sofern die Einheit eine offene Periode hat. Nimmt das System den Vollzug zurück,
MUST es dieses Ereignis samt Fan-out in derselben Transaktion streichen, mit dem Grund
„Ablösung zurückgenommen“. Würde diese Streichung die Folge der Einheit oder einer Person brechen,
etwa weil die Person nach dem Vollzug neu alarmiert wurde, MUST die Rücknahme mit 422 scheitern,
die Person nennen und nichts ändern. Die ablösende Einheit MUST durch den Vollzug kein Ereignis
bekommen.

#### Scenario: Vollzug beendet die Periode
- **WHEN** die Schicht von „Florian 1“ um 14:40 vollzogen wird und die Einheit seit 06:40 eingetroffen ist
- **THEN** endet ihre Periode um 14:40 mit der Art Ablösung

#### Scenario: Rücknahme öffnet die Periode wieder
- **WHEN** dieser Vollzug zurückgenommen wird
- **THEN** ist das Ablösungsereignis gestrichen, und die Periode ist wieder offen

#### Scenario: Rücknahme bricht eine spätere Folge
- **WHEN** eine Person der Einheit nach dem Vollzug neu alarmiert wurde und der Vollzug zurückgenommen werden soll
- **THEN** antwortet das System mit 422, nennt die Person, und die Einheit bleibt abgelöst

#### Scenario: Einheit ohne Periode
- **WHEN** eine Einheit ohne offene Periode abgelöst wird
- **THEN** gelingt der Vollzug, und ihre Zeitachse bekommt kein Ereignis

### Requirement: Einsatzdauer und Ruhezeit

Das System SHALL je Kraft beim Lesen ableiten: die laufende Einsatzdauer als Zeit vom Anker der
offenen Periode bis jetzt, wobei der Anker die Alarmierung ist und ohne Alarmierung das
Eintreffen; die Gesamteinsatzzeit als Summe aller Perioden, die offene bis jetzt; und die
Ruhezeit als Zeit seit dem Ende der letzten Periode, solange keine offen ist. Ohne Ereignisse
MUST jede dieser Angaben fehlen und darf nicht als 0 erscheinen. Das System MUST die Werte
nicht speichern und MUST sie nicht gegen Grenzwerte einstufen.

#### Scenario: Laufende Einsatzdauer
- **WHEN** eine Einheit mit Alarmierung 06:10 und Eintreffen 06:40 um 13:50 gelesen wird
- **THEN** beträgt ihre Einsatzdauer 7 h 40 min mit dem Anker Alarmierung 06:10

#### Scenario: Ruhezeit
- **WHEN** eine Person, deren Periode um 14:40 endete, um 18:00 gelesen wird
- **THEN** beträgt ihre Ruhezeit 3 h 20 min, und eine laufende Einsatzdauer fehlt

#### Scenario: Keine Ereignisse
- **WHEN** eine Einheit ohne Ereignisse gelesen wird
- **THEN** fehlen Einsatzdauer, Gesamteinsatzzeit und Ruhezeit

### Requirement: Rechte

Lesende Endpunkte der Zeitachse MUST Lesezugriff auf den Einsatz verlangen, dazu für Einheiten
das Modul Einheiten und für Personen das Modul Personal. Nachtrag und Streichung MUST
Schreibrecht im Einsatz, einen aktiven Einsatz und dasselbe Modul verlangen. Ist das Modul
ausgeblendet oder fehlt das Recht, MUST das System 403 liefern.

#### Scenario: Beobachter liest
- **WHEN** eine Person ohne Schreibrecht die Zeitachse einer Einheit abruft
- **THEN** erhält sie die Ereignisse

#### Scenario: Beobachter trägt nach
- **WHEN** eine Person ohne Schreibrecht einen Nachtrag absendet
- **THEN** antwortet das System mit 403

#### Scenario: Personal ausgeblendet
- **WHEN** das Modul Personal im Einsatz ausgeblendet ist und die Zeitachse einer Person abgerufen wird
- **THEN** antwortet das System mit 403

### Requirement: Anzeige

Das Meldebild SHALL je Einheit eine Spalte „Im Einsatz“ mit der laufenden Einsatzdauer führen,
in Mono mit Tabellenziffern, mit dem Anker als zugänglicher Beschreibung, und ohne Periode mit
„—“; die Spalte MUST auch im Druck erscheinen. Die Einheit-Detailseite SHALL die Zeitachse als
Folge von Zeitachseneinträgen zeigen, gestrichene Einträge durchgestrichen mit Grund, und
Nachtrag und Streichung anbieten. Die Personal-Seite des Einsatzes SHALL je Person Einsatzdauer
und Ruhezeit zeigen und die Zeitachse der Person aufklappbar machen, samt Nachtrag. Die Herkunft
eines Ereignisses (Status, über Einheit, Ablösung, nachgetragen) MUST als Wort erkennbar sein.
Keine Angabe darf blinken oder eingefärbt eingestuft werden. Ohne Schreibrecht MUST die Seite den
Grund nennen und Nachtrag und Streichung gesperrt statt entfernt zeigen.

#### Scenario: Meldebild ohne Ereignisse
- **WHEN** eine Einheit ohne Ereignisse im Meldebild steht
- **THEN** zeigt ihre Zelle „Im Einsatz“ „—“ und keine Zahl

#### Scenario: Meldebild mit laufender Periode
- **WHEN** eine Einheit seit Alarmierung 06:10 im Einsatz ist und um 13:50 betrachtet wird
- **THEN** zeigt ihre Zelle „7 h 40“, und die zugängliche Beschreibung nennt „seit Alarmierung 06:10“

#### Scenario: Herkunft sichtbar
- **WHEN** ein Personen-Ereignis per Fan-out entstanden ist
- **THEN** zeigt der Eintrag in der Zeitachse der Person das Wort „über Einheit“ mit dem Namen der Einheit
