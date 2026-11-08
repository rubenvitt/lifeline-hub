# kraefte-zeitachse Specification

## Purpose
Die Führung sieht je Einheit und je Person im Einsatz, wann sie alarmiert wurde, eingetroffen
ist, abgelöst oder entlassen wurde, und daraus die laufende Einsatzdauer, die Gesamteinsatzzeit
und die Ruhezeit. Die Zeitpunkte entstehen überwiegend aus Statuswechseln, die ohnehin gepflegt
werden.

LLH-1150 hebt das Non-Goal „keine Personal-Ebene“ aus LFH-635 für den Besatzungswechsel der
Ablösung auf: er schreibt Ereignisse nur an Personen (die alte Besatzung geht ab, die neue
kommt), die Einheit behält ihre Periode. Grenzwerte und Ruhezeitrechnung entstehen daraus nicht;
eingestuft wird nur nach der Anforderung „Einstufung gegen die Grenzwerte des Einsatzes“ (LLH-730,
vormals LFH-860).
## Requirements
### Requirement: Ereignisse der Zeitachse

Das System SHALL je Einheit und je Person eines Einsatzes ein Ereignisprotokoll führen. Ein
Ereignis trägt Art (`alarmierung`, `eintreffen`, `abloesung` oder `entlassung`), Zeitpunkt,
Quelle (`status`, `einheit`, `abloesung`, `nachtrag`, `disposition` oder `bereitstellungsraum`),
optional eine Notiz, die erfassende Person und den Erfassungszeitpunkt. Das Protokoll MUST
append-only sein: Ein Ereignis wird nie geändert oder gelöscht, nur gestrichen (siehe
Streichung). Die Reihenfolge der Ereignisse MUST sich nach ihrem Zeitpunkt richten, nicht nach dem
Erfassungszeitpunkt.

#### Scenario: Ereignis bleibt nach Streichung lesbar
- **WHEN** ein Ereignis „eintreffen 06:40“ gestrichen wird
- **THEN** liefert die Zeitachse es weiter, gekennzeichnet als gestrichen mit Zeitpunkt und Person der Streichung

#### Scenario: Nachtrag reiht sich nach Zeit ein
- **WHEN** um 09:00 ein Eintreffen für 06:40 nachgetragen wird und bereits eine Alarmierung um 06:10 besteht
- **THEN** steht das Eintreffen in der Zeitachse nach der Alarmierung

#### Scenario: Entlassen aus der Disposition
- **WHEN** eine Person über „Entlassen“ aus dem Einsatz genommen wird
- **THEN** trägt ihre Entlassung die Quelle `disposition`

#### Scenario: Eintreffen am Bereitstellungsraum
- **WHEN** eine Einheit am Bereitstellungsraum als eingetroffen gebucht wird
- **THEN** trägt ihr Eintreffen die Quelle `bereitstellungsraum`

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
Notiz von Hand erfassen lassen (Quelle `nachtrag`). Art und Zeitpunkt sind Pflicht; fehlt eines,
ist die Art unbekannt oder die Notiz länger als 500 Zeichen, MUST das System mit 400 antworten. Ein Zeitpunkt in der Zukunft oder
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
auch seine Fan-out-Kopie an einer Person, und jedes Ereignis der Quelle `abloesung` (auch das
Eintreffen der neuen Besatzung eines Besatzungswechsels, LLH-1150) MUST sich nur über die
Rücknahme des Vollzugs streichen lassen (422). Jede Streichung von Hand MUST einen System-ETB-Eintrag schreiben, der Kraft, Art,
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

### Requirement: Zeitpunkt berichtigen

Das System SHALL ein nicht gestrichenes Ereignis einer Einheit oder Person in einem Schritt auf
einen neuen Zeitpunkt berichtigen lassen, mit Pflichtgrund. In derselben Transaktion MUST es das
alte Ereignis mit diesem Grund streichen und eines derselben Art zum neuen Zeitpunkt schreiben
(Quelle `nachtrag`, Notiz des alten). Die Perioden-Regeln MUST nur für das Ergebnis gelten, nicht
für den Zwischenstand. Verletzt das Ergebnis sie bei der Kraft oder einer betroffenen Person, MUST
das System mit 422 antworten, die Person nennen und nichts schreiben.

An einer Einheit MUST jede Person im Einsatz, die eine nicht gestrichene Fan-out-Kopie des alten
Ereignisses trägt, statt ihrer eine Kopie des neuen bekommen; andere Personen, auch eine
inzwischen entlassene mit Kopie, MUST wie bei der Streichung unberührt bleiben. Die
Kopplung an die Ablösung MUST wie bei einer Streichung mit anschließendem Nachtrag laufen;
nur eine mit dem berichtigten Eintreffen automatisch begonnene Schicht MUST nicht entfallen,
sondern auf das neue Eintreffen wandern (LLH-1508, Spec `kraefte-abloesung` „Schicht mit dem
Eintreffen“).

Grund leer oder länger als 500 Zeichen (ebenso bei der Streichung), Zeitpunkt fehlt bzw.
unlesbar → 400. Zeitpunkt in der Zukunft, unveränderter
Zeitpunkt, schon gestrichenes Ereignis und ein Ereignis der Art oder Quelle `abloesung` → 422.
Fremde Kraft oder fremdes Ereignis → 404. Jede Berichtigung MUST genau einen eigenen
System-ETB-Eintrag schreiben, der Kraft, Art, alten und neuen Zeitpunkt und den Grund nennt; die
Einträge der Kopplung an die Ablösung (etwa „läuft wieder“ und „mit der Entlassung beendet“)
kommen dazu.

#### Scenario: Eintreffen als Anker berichtigen
- **WHEN** „Florian 1“ ohne Alarmierung um 06:40 eintraf, um 14:00 entlassen wurde und das Eintreffen mit Grund „Zeit verwechselt“ auf 06:30 berichtigt wird
- **THEN** ist das Eintreffen 06:40 gestrichen, ein Eintreffen 06:30 mit Herkunft „nachgetragen“ steht da, die Periode reicht von 06:30 bis 14:00
- **AND** das ETB nennt „Zeitachse: Einheit «Florian 1» eingetroffen berichtigt von … auf … — Grund: Zeit verwechselt“

#### Scenario: Kopien der Personen folgen
- **WHEN** das Eintreffen von „Florian 1“ berichtigt wird und zwei Personen seine Kopie tragen, eine dritte erst danach zugeordnet wurde
- **THEN** tragen die beiden das Eintreffen zum neuen Zeitpunkt über die Einheit, und die dritte bekommt keins

#### Scenario: Ergebnis verletzt die Regeln
- **WHEN** die Alarmierung 06:10 einer Periode mit Eintreffen 06:40 auf 07:00 berichtigt werden soll
- **THEN** antwortet das System mit 422, und Zeitachse und ETB bleiben unverändert

#### Scenario: Person verlöre ihre Ordnung
- **WHEN** eine Person mit Kopie des Eintreffens 06:40 der Einheit selbst um 06:50 entlassen wurde und das Eintreffen der Einheit auf 07:00 berichtigt werden soll
- **THEN** antwortet das System mit 422, nennt die Person und schreibt nichts

#### Scenario: Unveränderter Zeitpunkt
- **WHEN** ein Ereignis auf seinen eigenen Zeitpunkt berichtigt werden soll
- **THEN** antwortet das System mit 422

#### Scenario: Ereignis aus dem Vollzug
- **WHEN** eine Ablösung oder das Eintreffen einer neuen Besatzung berichtigt werden soll
- **THEN** antwortet das System mit 422

### Requirement: Periode nachtragen

Das System SHALL an einer Einheit oder Person eine abgeschlossene Einsatzperiode in einem Schritt
nachtragen lassen: Alarmierung und/oder Eintreffen und eine Entlassung (Quelle `nachtrag`, Notiz
optional am Beginn), in einer Transaktion. Fehlen Alarmierung und Eintreffen zugleich, fehlt die
Entlassung, ist eine Zeit unlesbar oder die Notiz länger als 500 Zeichen, MUST das System mit
400 antworten. Ein Zeitpunkt in der
Zukunft, eine Alarmierung nach dem Eintreffen, ein Ende nicht nach dem Beginn, ein Ergebnis, das
die Perioden-Regeln verletzt, oder eines, in dem die Ereignisse keine eigene Periode bilden,
MUST mit 422 scheitern und nichts schreiben. Die Perioden-Regeln MUST nur am Ergebnis geprüft
werden. An einer Einheit MUST jede jetzt zugeordnete Person die Periode als Kopie bekommen, in
deren Folge sie passt; eine andere MUST keine Kopie bekommen, auch keine teilweise. Die Kopplung
an die Ablösung MUST erst am fertigen Stand laufen: Alarmierung und Eintreffen der
nachgetragenen Periode MUST weder einen Hinweis geben noch eine Schicht beginnen; die Entlassung
MUST eine laufende Schicht nur beenden, wenn danach keine Periode offen ist. Der Weg MUST einen
System-ETB-Eintrag schreiben, der Kraft und die Zeitpunkte nennt.

#### Scenario: Periode vor der laufenden nachtragen
- **WHEN** „Florian 1“ seit 22:00 alarmiert ist und eine Periode Alarmierung 06:10, Eintreffen 06:40, Entlassung 14:00 nachgetragen wird
- **THEN** trägt die Einheit zwei Perioden, die laufende ab 22:00 bleibt offen, und das ETB nennt „Einsatzperiode nachgetragen: alarmiert …, eingetroffen …, entlassen …“

#### Scenario: Überschneidung
- **WHEN** eine Einheit mit Eintreffen 11:00 und offener Periode eine Periode 10:00 bis 12:00 nachgetragen bekommen soll
- **THEN** antwortet das System mit 422 und schreibt nichts

#### Scenario: Ende vor dem Beginn
- **WHEN** eine Periode mit Eintreffen 14:00 und Entlassung 06:00 nachgetragen werden soll
- **THEN** antwortet das System mit 422

#### Scenario: Fan-out ganz oder gar nicht
- **WHEN** an „Florian 1“ eine Periode nachgetragen wird und eine ihrer Personen in diesem Zeitraum schon eine Periode trägt
- **THEN** bekommen die übrigen Personen alle Kopien, diese Person keine

### Requirement: Kopplung an die Ablösung

Vollzieht das System eine Ablösungsschicht einer Einheit, SHALL es in derselben Transaktion ein
Ereignis `abloesung` zum Vollzugszeitpunkt für diese Einheit schreiben (Quelle `abloesung`),
samt Fan-out, sofern die Einheit eine offene Periode hat; ebenso für jede Untereinheit, die die
Schicht erbt (Knoten-Modell, LLH-1132), je mit eigenem Fan-out. Nimmt das System den Vollzug
zurück, MUST es diese Ereignisse samt Fan-out in derselben Transaktion streichen, mit dem Grund
„Ablösung zurückgenommen“. Würde diese Streichung die Folge der Einheit oder einer Person brechen,
etwa weil die Person nach dem Vollzug neu alarmiert wurde, MUST die Rücknahme mit 422 scheitern,
die Person nennen und nichts ändern. Die ablösenden Einheiten MUST durch den Vollzug kein
Ereignis bekommen, auch eine übernommene Schicht nicht.

Ein Besatzungswechsel (LLH-1150, Spec `kraefte-abloesung`) SHALL statt der Einheit nur Personen
schreiben, je über den einzigen Schreibpfad und mit Quelle `abloesung`: jede Person der alten
Besatzung (der Einheit und ihrer erbenden Untereinheiten) bekommt `abloesung`, jede der neuen
`eintreffen`, sofern die Perioden-Regeln der Person es zulassen (sonst bleibt ihre Zeitachse
unberührt, der Vollzug gelingt). Die Einheiten MUST kein Ereignis bekommen; ihre Periode läuft
weiter. Die Rücknahme MUST genau diese Ereignisse streichen, mit derselben 422-Regel wie oben.

Umgekehrt SHALL der einzige Schreibpfad der Zeitachse an einer Einheit die Schicht der Ablösung
mitführen (LLH-1128, Spec `kraefte-abloesung`): das Eintreffen der offenen Periode beginnt eine
Schicht („Schicht mit dem Eintreffen“), eine Entlassung, nach der keine Periode mehr offen ist,
beendet sie, die Streichung dieser Entlassung öffnet sie wieder („Ende mit der Entlassung“).
Ein Fehler dabei MUST den Statuswechsel, Nachtrag oder die Buchung nicht scheitern lassen.

#### Scenario: Nachgetragenes Eintreffen beginnt die Schicht
- **WHEN** der Einsatz eine Vorgabe hat und für eine Einheit ohne Schicht ein Eintreffen nachgetragen wird
- **THEN** läuft eine Schicht ab dem nachgetragenen Zeitpunkt, und das Live-Ereignis `abloesung` geht hinaus

#### Scenario: Eintreffen am Bereitstellungsraum
- **WHEN** eine Einheit am Bereitstellungsraum eintrifft und der Einsatz eine Vorgabe hat
- **THEN** beginnt ihre Schicht zum Zeitpunkt der Buchung; die Buchung behält ihren einen ETB-Eintrag, die Ablösung schreibt ihren eigenen

#### Scenario: Vollzug beendet die Periode
- **WHEN** die Schicht von „Florian 1“ um 14:40 vollzogen wird und die Einheit seit 06:40 eingetroffen ist
- **THEN** endet ihre Periode um 14:40 mit der Art Ablösung

#### Scenario: Vollzug an einer Untereinheit, die erbt
- **WHEN** die Schicht von „Zug 1“ vollzogen wird und „Gruppe 1“ sie erbt
- **THEN** endet auch die Periode von „Gruppe 1“ und ihrer Personen mit der Ablösung, und die Rücknahme öffnet beide wieder

#### Scenario: Rücknahme öffnet die Periode wieder
- **WHEN** dieser Vollzug zurückgenommen wird
- **THEN** ist das Ablösungsereignis gestrichen, und die Periode ist wieder offen

#### Scenario: Rücknahme bricht eine spätere Folge
- **WHEN** eine Person der Einheit nach dem Vollzug neu alarmiert wurde und der Vollzug zurückgenommen werden soll
- **THEN** antwortet das System mit 422, nennt die Person, und die Einheit bleibt abgelöst

#### Scenario: Einheit ohne Periode
- **WHEN** eine Einheit ohne offene Periode abgelöst wird
- **THEN** gelingt der Vollzug, und ihre Zeitachse bekommt kein Ereignis

#### Scenario: Besatzungswechsel
- **WHEN** an „Florian 1“ (seit 09:30 eingetroffen, mit „Anna Alt“) um 15:40 die Besatzung zu „Cora Neu“ wechselt
- **THEN** endet die Periode von „Anna Alt“ um 15:40 mit der Art Ablösung, die von „Cora Neu“ beginnt um 15:40 mit dem Eintreffen, und die Periode von „Florian 1“ läuft weiter
- **AND** das Eintreffen von „Cora Neu“ lässt sich von Hand nicht streichen (422), nur die Rücknahme streicht beide

### Requirement: Einsatzdauer und Ruhezeit

Das System SHALL je Kraft beim Lesen ableiten: die laufende Einsatzdauer als Zeit vom Anker der
offenen Periode bis jetzt, wobei der Anker die Alarmierung ist und ohne Alarmierung das
Eintreffen; die Gesamteinsatzzeit als Summe aller Perioden, die offene bis jetzt; und die
Ruhezeit als Zeit seit dem Ende der letzten Periode, solange keine offen ist. Ohne Ereignisse
MUST jede dieser Angaben fehlen und darf nicht als 0 erscheinen. Das System MUST die Werte
nicht speichern. Eingestuft wird nur nach der Anforderung „Einstufung gegen die Grenzwerte des
Einsatzes“.

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
das Modul Einheiten und für Personen das Modul Personal. Nachtrag, Berichtigung und Streichung MUST
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
Nachtrag, Berichtigung des Zeitpunkts („Zeit berichtigen“) und Streichung anbieten. Die
Personalliste des Einsatzes SHALL je Person die Einsatzdauer zeigen und die Ruhezeit als Spalte
über den Spaltenschalter anbieten; sie MUST NOT die Zeitachse einer Person aufklappen. Die
Personenansicht SHALL im Kopf die laufende Einsatzdauer bzw. die Ruhezeit zeigen und die
Zeitachse der Person als eigenen Abschnitt nach Einteilung und Person führen, samt Nachtrag,
Berichtigung und Streichung. Die Herkunft eines Ereignisses (Status, über Einheit, Ablösung,
nachgetragen) MUST als Wort erkennbar sein. Keine Angabe darf blinken. Eingefärbt eingestuft
werden MUST nur die Zelle „Im Einsatz“ des Meldebilds und die Zelle „Einsatzdauer“ der
Personalliste, und nur nach der Anforderung „Einstufung gegen die Grenzwerte des Einsatzes“;
jede andere Angabe der Zeitachse, auch die Spalte „Ruhe“, bleibt neutral. Ohne Schreibrecht MUST
die Seite den Grund nennen und Nachtrag, Berichtigung und Streichung gesperrt statt entfernt
zeigen.

#### Scenario: Meldebild ohne Ereignisse
- **WHEN** eine Einheit ohne Ereignisse im Meldebild steht
- **THEN** zeigt ihre Zelle „Im Einsatz“ „—“ und keine Zahl

#### Scenario: Meldebild mit laufender Periode
- **WHEN** eine Einheit seit Alarmierung 06:10 im Einsatz ist und um 13:50 betrachtet wird
- **THEN** zeigt ihre Zelle „7 h 40“, und die zugängliche Beschreibung nennt „seit Alarmierung 06:10“

#### Scenario: Herkunft sichtbar
- **WHEN** ein Personen-Ereignis per Fan-out entstanden ist
- **THEN** zeigt der Eintrag in der Zeitachse der Person das Wort „über Einheit“ mit dem Namen der Einheit

#### Scenario: Zeitachse in der Ansicht, nicht in der Liste
- **WHEN** die Personalliste und danach die Personenansicht einer Person mit Alarmierung 06:10 geöffnet werden
- **THEN** trägt die Zeile der Liste die Einsatzdauer und keinen Aufklapper „Zeitachse“, und die Ansicht zeigt die Alarmierung 06:10 im Abschnitt „Zeitachse“ mit „Nachtragen“

#### Scenario: Ruhe im Spaltenschalter
- **WHEN** die Personalliste ohne eigene Spaltenwahl geöffnet wird
- **THEN** ist die Spalte „Ruhe“ ausgeblendet, im Zähler des Spaltenschalters mitgezählt und dort einblendbar

#### Scenario: Zeit berichtigen im Dialog
- **WHEN** an einem Eintreffen 06:40 „Zeit berichtigen“ gewählt wird
- **THEN** öffnet ein Dialog mit dem Zeitpunkt 06:40 vorbelegt und einem Pflichtfeld Grund, und eine Ablehnung des Servers steht im Dialog

#### Scenario: Ruhe bleibt neutral
- **WHEN** eine Person seit 2 h in Ruhe ist und die Mindestruhe 8 h beträgt
- **THEN** zeigt die Spalte „Ruhe“ „2 h 00“ ohne Einfärbung und ohne Wort

### Requirement: Keine Kraft verliert ihre Zeitachse

Eine Person oder Einheit mit mindestens einem Zeitachsen-Ereignis MUST NOT gelöscht werden
können; die Datenbank MUST das Löschen ablehnen statt die Ereignisse mitzulöschen. Das Löschen
eines ganzen Einsatzes (Aufbewahrung, Demo-Daten) MUST seine Zeitachse weiter mit entfernen.

#### Scenario: Löschen scheitert
- **WHEN** eine Anweisung die Zeile einer Person mit Zeitachse löschen will
- **THEN** scheitert sie am Fremdschlüssel, und die Ereignisse bleiben

#### Scenario: Einsatz-Purge
- **WHEN** die Aufbewahrung einen Einsatz endgültig löscht
- **THEN** sind auch seine Zeitachsen-Ereignisse entfernt

### Requirement: Eintreffen am Bereitstellungsraum

Bucht der Bereitstellungsraum das Eintreffen einer Einheit, SHALL das System in derselben
Transaktion das Ereignis `eintreffen` mit Quelle `bereitstellungsraum` und dem
Erfassungszeitpunkt der Buchung schreiben; der Fan-out auf die Personen der Einheit MUST wie bei
jedem Einheit-Ereignis folgen. Verletzt das Ereignis die Perioden-Regeln, MUST es ausgelassen
werden, und die Buchung MUST trotzdem gelingen. Das gilt auch für eine Einheit, die bei der
Buchung erst entsteht (unangemeldete Kraft): ihre Einsatzdauer beginnt mit dem Eintreffen am
Bereitstellungsraum. Die Buchung MUST NOT den Wortlaut „(nachgetragen)“ ins ETB schreiben. Die
Herkunft MUST in der Zeitachse als „am Bereitstellungsraum“ erkennbar sein.

#### Scenario: Unangemeldete Einheit
- **WHEN** eine unangemeldete Kraft um 14:30 am BR Sportplatz gebucht wird
- **THEN** beginnt die Periode der neuen Einheit um 14:30 mit einem Eintreffen, Quelle `bereitstellungsraum`

#### Scenario: Fan-out
- **WHEN** eine Einheit mit zwei zugeordneten Personen am BR als eingetroffen gebucht wird
- **THEN** tragen beide Personen ein Eintreffen zum selben Zeitpunkt mit Quelle `einheit`

#### Scenario: Herkunft in der Anzeige
- **WHEN** die Zeitachse einer am BR eingetroffenen Einheit angezeigt wird
- **THEN** nennt der Eintrag „am Bereitstellungsraum“ und nicht „nachgetragen“

### Requirement: Einstufung gegen die Grenzwerte des Einsatzes

Das System SHALL die laufende Periode einer Kraft gegen die **wirksamen** Grenzwerte des
Einsatzes einstufen, also gegen dieselben Werte, die der Plan-Befund `dienst` liest (Capability
`kraefte-schichtplan`, „Grenzwerte des Einsatzes“): Höchstdienst und Mindestruhe, ohne eigenen
Wert 12 h bzw. 8 h. Es MUST keine zweite Einstellung geben.

- **Dienststrecke:** Die Perioden einer Kraft bilden in zeitlicher Folge Strecken. Eine Lücke
  zwischen dem Ende einer Periode und dem Beginn der nächsten trennt zwei Strecken nur, wenn sie
  größer als null und mindestens die Mindestruhe ist. Die laufende Strecke ist die Strecke mit der
  offenen Periode; ihre Länge zählt vom Beginn ihrer ersten Periode bis jetzt.
- **„zu lang“:** Ist die laufende Strecke echt länger als der Höchstdienst, MUST die Kraft „zu
  lang“ heißen.
- **„Ruhe zu kurz“:** Liegt vor der offenen Periode eine Periode und ist die Lücke dazwischen
  größer als null und kleiner als die Mindestruhe, MUST die Kraft „Ruhe zu kurz“ heißen, sofern
  sie nicht schon „zu lang“ heißt.

Ohne offene Periode MUST es keine Einstufung geben. Ohne Ereignis MUST es keine Einstufung geben,
und eine fehlende Zahl MUST NOT als 0 gelten. Das System MUST die Einstufung nicht speichern. Sie
MUST NOT einen Hinweis in der AlarmZentrale, einen Modulzähler oder eine Benachrichtigung
auslösen.

Die Einstufung SHALL in der Rolle `achtung` mit dem Wort als zweitem Kanal erscheinen: in der
Zelle „Im Einsatz“ des Meldebilds und in der Zelle „Einsatzdauer“ der Personalliste, neben der
unveränderten Zahl. Die zugängliche Beschreibung MUST Beginn und Länge der Strecke bzw. die Länge
der Ruhe und den Grenzwert nennen. Sind die Grenzwerte nicht geladen, MUST die Zelle die Zahl
ohne Einstufung zeigen.

#### Scenario: Zu lang in einer Periode
- **WHEN** die Vorgaben 12 h / 8 h gelten und eine Einheit seit Alarmierung 06:10 im Einsatz ist und um 18:30 betrachtet wird
- **THEN** zeigt ihre Zelle „Im Einsatz“ „12 h 20“ mit dem Wort „zu lang“ in der Rolle `achtung`

#### Scenario: Genau am Höchstwert
- **WHEN** die Vorgaben 12 h / 8 h gelten und eine Einheit seit Alarmierung 06:10 im Einsatz ist und um 18:10 betrachtet wird
- **THEN** zeigt ihre Zelle „12 h 00“ ohne Einstufung

#### Scenario: Kurze Pause trennt die Strecke nicht
- **WHEN** die Vorgaben 12 h / 8 h gelten und eine Person 08:00–14:00 im Einsatz war und seit 16:00 wieder im Einsatz ist und um 22:30 betrachtet wird
- **THEN** zeigt ihre Zelle „Einsatzdauer“ „6 h 30“ mit dem Wort „zu lang“, und die Beschreibung nennt die Strecke seit 08:00 mit 14 h 30

#### Scenario: Ruhe zu kurz
- **WHEN** die Vorgaben 12 h / 8 h gelten und eine Person 08:00–14:00 im Einsatz war und seit 16:00 wieder im Einsatz ist und um 17:00 betrachtet wird
- **THEN** zeigt ihre Zelle „Einsatzdauer“ „1 h 00“ mit dem Wort „Ruhe zu kurz“, und die Beschreibung nennt 2 h 00 Ruhe bei 8 h Mindestruhe

#### Scenario: Genug Ruhe
- **WHEN** die Vorgaben 12 h / 8 h gelten und eine Person 06:00–12:00 im Einsatz war und seit 20:00 wieder im Einsatz ist und um 23:00 betrachtet wird
- **THEN** zeigt ihre Zelle „3 h 00“ ohne Einstufung

#### Scenario: Eigener Wert des Einsatzes
- **WHEN** der Einsatz den Höchstdienst auf 6 h setzt und eine Einheit seit Alarmierung 06:10 im Einsatz ist und um 12:30 betrachtet wird
- **THEN** zeigt ihre Zelle „6 h 20“ mit dem Wort „zu lang“, und der Plan prüft mit demselben Wert

#### Scenario: Ohne offene Periode
- **WHEN** eine Person, deren Periode nach 13 h um 19:00 endete, um 20:00 betrachtet wird
- **THEN** zeigt ihre Zelle „Einsatzdauer“ „—“ ohne Einstufung, und die Spalte „Ruhe“ zeigt „1 h 00“ neutral

#### Scenario: Ohne Ereignis
- **WHEN** eine Einheit ohne Ereignisse im Meldebild steht
- **THEN** zeigt ihre Zelle „—“ ohne Einstufung

#### Scenario: Grenzwerte nicht geladen
- **WHEN** der Abruf der Grenzwerte scheitert und eine Einheit seit 14 h im Einsatz ist
- **THEN** zeigt ihre Zelle die Einsatzdauer ohne Einstufung

#### Scenario: Kein Alarm
- **WHEN** eine Einheit „zu lang“ heißt
- **THEN** entsteht kein Eintrag in der AlarmZentrale, kein Modulzähler und keine Benachrichtigung

### Requirement: Grenzwerte lesen

Das System SHALL die wirksamen Grenzwerte des Einsatzes unter
`GET /api/einsaetze/{id}/einheiten/zeitachse/grenzwerte` und
`GET /api/einsaetze/{id}/personal/zeitachse/grenzwerte` liefern, in derselben Form wie im
Schichtplan (Höchstdienst und Mindestruhe in Minuten, je mit der Angabe, ob der Einsatz den Wert
selbst setzt). Die Endpunkte MUST Lesezugriff auf den Einsatz und das Modul Einheiten bzw.
Personal verlangen und MUST NOT das Modul Ablösung verlangen. Eine Änderung der Grenzwerte MUST
die geöffneten Ansichten live erreichen.

#### Scenario: Ohne Modul Ablösung
- **WHEN** das Modul Ablösung im Einsatz ausgeblendet ist und jemand mit Lesezugriff die Grenzwerte unter Einheiten abruft
- **THEN** erhält er Höchstdienst 720 und Mindestruhe 480 Minuten, beide als Vorgabe

#### Scenario: Personal ausgeblendet
- **WHEN** das Modul Personal im Einsatz ausgeblendet ist und die Grenzwerte unter Personal abgerufen werden
- **THEN** antwortet das System mit 403

#### Scenario: Änderung live
- **WHEN** jemand im Schichtplan den Höchstdienst auf 6 h setzt, während das Meldebild offen ist
- **THEN** stuft das Meldebild ohne Neuladen gegen 6 h ein

