# Spec Delta

## Purpose

Legt fest, welches Ereignis im Einsatz und in der Organisation wen benachrichtigt und wie laut,
damit die Führung erfährt, was sie betrifft, ohne selbst nachsehen zu müssen und ohne von
Fremdem überflutet zu werden.

## ADDED Requirements

### Requirement: Drei Stufen

Jede Benachrichtigung SHALL genau eine Stufe tragen. *Alarm*: lauter Ton, Toast, OS-Meldung bei
verdecktem Tab. *Hinweis*: dezenter Ton, Toast, OS-Meldung bei verdecktem Tab. *Still*: kein
Ton, kein Toast, keine OS-Meldung; das Ereignis zeigt sich nur in Zählern, Marken und Listen.
Toasts beider lauten Stufen MUST stehen bleiben, bis sie geschlossen oder geöffnet werden.

#### Scenario: Hinweis im sichtbaren Tab
- **WHEN** eine Person mit sichtbarem Einsatz-Tab eine Benachrichtigung der Stufe Hinweis erhält
- **THEN** spielt der dezente Ton, ein Toast erscheint, und es entsteht keine OS-Meldung

#### Scenario: Alarm im verdeckten Tab
- **WHEN** eine Person mit verdecktem Einsatz-Tab und erlaubten OS-Meldungen einen Alarm erhält
- **THEN** spielt der laute Ton, ein Toast erscheint, und eine OS-Meldung erscheint

#### Scenario: Stilles Ereignis
- **WHEN** eine Chat-Nachricht ohne Erwähnung eingeht
- **THEN** ändert sich nur der Zähler am Modul Chat; es gibt keinen Ton und keinen Toast

### Requirement: Der Server bestimmt die Empfänger

Der Server SHALL für jede Benachrichtigung die Empfänger als Menge von Nutzern bestimmen und sie
nur an deren Verbindungen zustellen. Andere Nutzer MUST NOT von ihr erfahren, auch nicht als
leeres Ereignis. Ein Empfänger MUST das Modul sehen dürfen, dem das auslösende Objekt gehört.

#### Scenario: Auftrag an S4
- **WHEN** ein Auftrag an die Funktion S4 erteilt wird und Person A S4 besetzt, Person B S2
- **THEN** erhält Person A eine Benachrichtigung, Person B keine, und B's Live-Strom trägt kein Benachrichtigungs-Ereignis dafür

#### Scenario: Empfänger ohne Modulrecht
- **WHEN** eine Person eine Funktion im Verteiler eines Befehls besetzt, das Modul Befehle aber nicht sehen darf
- **THEN** erhält sie keine Benachrichtigung zu diesem Befehl

### Requirement: Meine Funktion

Eine Benachrichtigung an eine Führungsfunktion SHALL die Nutzer erreichen, die diese Funktion im
Einsatz besetzen. Maßgeblich MUST die Stab-Besetzung sein (Funktion → Einsatzpersonal →
verknüpfter Nutzer). Nur wenn die Funktion dort nicht besetzt ist oder keinen Nutzer verknüpft
hat, MUST die Funktion aus der Einsatz-Mitgliedschaft gelten.

#### Scenario: Stab-Besetzung geht vor
- **WHEN** S3 laut Stab-Besetzung mit Person A besetzt ist und Person B in ihrer Mitgliedschaft die Funktion S3 trägt
- **THEN** erreicht eine Benachrichtigung an S3 nur Person A

#### Scenario: Ersatz über die Mitgliedschaft
- **WHEN** S6 in der Stab-Besetzung unbesetzt ist und Person C in ihrer Mitgliedschaft die Funktion S6 trägt
- **THEN** erreicht eine Benachrichtigung an S6 Person C

#### Scenario: Niemand besetzt die Funktion
- **WHEN** eine Benachrichtigung an S5 geht und weder Stab-Besetzung noch Mitgliedschaft S5 einem Nutzer zuordnen
- **THEN** erhält niemand eine Benachrichtigung, und das Ereignis bleibt in Zählern und Listen sichtbar

### Requirement: Eigene Aktionen benachrichtigen den Auslöser nicht

Löst ein Nutzer ein Ereignis selbst aus, SHALL er dafür keine Benachrichtigung erhalten, auf
keiner seiner Verbindungen und auch dann nicht, wenn er zugleich Empfänger ist. Das gilt für alle
Stufen einschließlich Alarm. Ereignisse des Schedulers haben keinen Auslöser.

#### Scenario: Eigene Sofortmeldung
- **WHEN** Person A eine Sofortmeldung erfasst und Person B das Modul Meldungen sieht
- **THEN** erhält B den Alarm, A nicht, auch nicht in ihrem zweiten Tab

#### Scenario: Auftrag an die eigene Funktion
- **WHEN** Person A als S4 einen Auftrag an S4 erteilt
- **THEN** erhält A keine Benachrichtigung dazu

### Requirement: Benachrichtigungen ohne sensible Nutzlast

Das Live-Ereignis einer Benachrichtigung SHALL nur Kennungen tragen (Benachrichtigung, Einsatz,
Art, Stufe, Bezugsobjekt). Den anzuzeigenden Text MUST das Frontend über eine Abfrage holen, die
nur dem Empfänger antwortet.

#### Scenario: Toast-Text
- **WHEN** eine Benachrichtigung „Auftrag #12 an S4“ zugestellt wird
- **THEN** enthält das Live-Ereignis keinen Auftragstext, und der Toast zeigt den Text aus der Abfrage

#### Scenario: Fremde Abfrage
- **WHEN** Person B die Benachrichtigung von Person A per Kennung abfragt
- **THEN** antwortet der Server mit 404

### Requirement: Sofortmeldung alarmiert

Eine Sofortmeldung (Meldungsart Sofortmeldung oder Priorität sofort) SHALL alle mit dem Modul
Meldungen mit der Stufe Alarm benachrichtigen, außer dem Erfasser. Die Eskalation durch den
Scheduler MUST erneut alarmieren, dann auch den Erfasser.

#### Scenario: Neue Sofortmeldung
- **WHEN** eine Sofortmeldung erfasst wird
- **THEN** erhalten alle mit dem Modul Meldungen außer dem Erfasser einen Alarm „Sofortmeldung eingegangen“

#### Scenario: Eskalation
- **WHEN** eine Sofortmeldung unbestätigt bleibt und der Scheduler sie eskaliert
- **THEN** erhalten alle mit dem Modul Meldungen einschließlich des Erfassers einen Alarm „Bestätigung ausstehend“

### Requirement: Überfälliger Auftrag alarmiert Auftraggeber und Empfänger

Wird ein Auftrag überfällig, SHALL der Auftraggeber und jeder Nutzer, der zu einem noch nicht
quittierenden Empfänger des Auftrags gehört (Funktion oder Person), einen Alarm erhalten. Andere
Nutzer MUST NOT benachrichtigt werden; sie sehen den Zähler am Modul Aufträge.

#### Scenario: Auftrag an S2 überfällig
- **WHEN** ein Auftrag von Person A an S2 (Person B) seine Frist überschreitet, ohne dass S2 quittiert hat
- **THEN** erhalten A und B einen Alarm „Auftrag überfällig“, Person C mit dem Modul Aufträge nicht

#### Scenario: Empfänger hat quittiert
- **WHEN** ein Auftrag an S2 und S3 überfällig wird und S3 bereits quittiert hat
- **THEN** erhalten der Auftraggeber und S2 den Alarm, S3 nicht

### Requirement: Fällige Erinnerung erreicht ihre Empfänger

Wird eine Erinnerung fällig, SHALL sie als Hinweis die Nutzer ihrer Empfängerfunktion erreichen;
ist keine Empfängerfunktion gesetzt, ihren Ersteller. Erinnerungen mit Bezug Meldung oder
Ablösung MUST weiter nicht als eigene Erinnerung benachrichtigen.

#### Scenario: Erinnerung an S1
- **WHEN** eine Erinnerung mit Empfängerfunktion S1 fällig wird
- **THEN** erhalten die Nutzer von S1 einen Hinweis „Erinnerung fällig“, andere nicht

#### Scenario: Erinnerung ohne Empfänger
- **WHEN** eine Erinnerung ohne Empfängerfunktion fällig wird
- **THEN** erhält ihr Ersteller den Hinweis

### Requirement: Ablösung und Unwetter bleiben, wie sie sind

Ablösung (Vorwarnung als Hinweis, Fälligkeit als Alarm, an alle mit dem Modul Ablösung) und
Unwetter (Hinweis, an alle im Einsatz, im Browser erkannt) SHALL ihr bisheriges Verhalten behalten
und dem gemeinsamen Budget der Benachrichtigungen unterliegen.

#### Scenario: Ablösung fällig
- **WHEN** eine Schicht fällig wird
- **THEN** erhalten alle mit dem Modul Ablösung einen Alarm „Ablösung fällig“ wie bisher

### Requirement: Auftrag erteilt

Wird ein Auftrag erteilt, SHALL jeder Nutzer, der zu einem Empfänger des Auftrags gehört
(Funktion oder Person), einen Hinweis „Neuer Auftrag“ erhalten. Empfänger vom Typ Einheit,
Abschnitt, Fahrzeug oder extern MUST NOT Nutzer benachrichtigen.

#### Scenario: Auftrag an eine Person
- **WHEN** ein Auftrag an die Einsatzkraft erteilt wird, deren Personal mit Nutzer D verknüpft ist
- **THEN** erhält D einen Hinweis „Neuer Auftrag“ mit Sprung zum Auftrag

#### Scenario: Auftrag an eine Einheit
- **WHEN** ein Auftrag nur an die Einheit „Florian 1“ erteilt wird
- **THEN** erhält kein Nutzer eine Benachrichtigung

### Requirement: Auftrag quittiert oder erledigt

Quittiert ein Empfänger einen Auftrag oder meldet ihn erledigt, SHALL der Auftraggeber einen
Hinweis erhalten.

#### Scenario: Quittung
- **WHEN** S2 einen Auftrag von Person A quittiert
- **THEN** erhält A einen Hinweis „Auftrag quittiert: S2“

### Requirement: Befehl oder Lagebericht im Verteiler

Wird ein Befehl oder ein Lagebericht freigegeben, SHALL jeder Nutzer einer Funktion in seinem
Verteiler einen Hinweis erhalten. Verteiler vom Typ Einheit, Abschnitt oder extern MUST NOT Nutzer
benachrichtigen.

#### Scenario: Befehl an S3 und S4
- **WHEN** ein Befehl mit Verteiler S3 und S4 freigegeben wird
- **THEN** erhalten die Nutzer von S3 und S4 einen Hinweis „Neuer Befehl“

### Requirement: Meldung an mich

Eine Meldung SHALL neben dem freien Empfängertext eine Empfängerfunktion tragen können. Wird eine
Meldung mit Empfängerfunktion erfasst, MUST jeder Nutzer dieser Funktion einen Hinweis „Neue
Meldung“ erhalten. Ist sie eine Sofortmeldung, MUST stattdessen die
Anforderung „Sofortmeldung alarmiert“ gelten, ohne zweite Benachrichtigung.

#### Scenario: Meldung an S2
- **WHEN** eine Meldung mit Empfänger S2 erfasst wird
- **THEN** erhalten die Nutzer von S2 einen Hinweis „Neue Meldung“

#### Scenario: Sofortmeldung an S2
- **WHEN** eine Sofortmeldung mit Empfänger S2 erfasst wird
- **THEN** erhalten die Nutzer von S2 genau eine Benachrichtigung, den Alarm

### Requirement: Lagebesprechung steht an

Für den nächsten Termin der Lagebesprechung SHALL der Stab (Nutzer der besetzten Funktionen EL und
S1 bis S7) 10 Minuten vorher einen Hinweis „Lagebesprechung in 10 Minuten“ und bei Erreichen des
Termins einen Hinweis „Lagebesprechung jetzt fällig“ erhalten. Wird der Termin verschoben, MUST
die Ankündigung für den neuen Termin gelten, nicht für den alten.

#### Scenario: Termin 14:00
- **WHEN** die nächste Lagebesprechung für 14:00 angesetzt ist
- **THEN** erhält der Stab um 13:50 und um 14:00 je einen Hinweis

#### Scenario: Termin verschoben
- **WHEN** der Termin um 13:45 von 14:00 auf 14:30 verschoben wird
- **THEN** kommt um 13:50 kein Hinweis, sondern um 14:20 und 14:30

### Requirement: Status einer Nachforderung

Wechselt eine Nachforderung ihren Status (zugesagt, unterwegs, eingetroffen, abgelehnt), SHALL ihr
Ersteller und die Nutzer von S4 einen Hinweis mit dem neuen Status erhalten.

#### Scenario: Nachforderung eingetroffen
- **WHEN** die Nachforderung „2 RTW“ von Person A auf eingetroffen wechselt
- **THEN** erhalten A und S4 einen Hinweis „Nachforderung eingetroffen: 2 RTW“

### Requirement: Neue Gefahr

Wird eine Gefahr neu eingetragen, SHALL jeder mit dem Modul Lagekarte einen Hinweis „Neue Gefahr“
erhalten. Änderungen an bestehenden Gefahren MUST still bleiben.

#### Scenario: Gefahr eingetragen
- **WHEN** eine Gefahr „Gasaustritt“ neu eingetragen wird
- **THEN** erhalten alle mit dem Modul Lagekarte einen Hinweis mit Sprung zur Gefahr auf der Lagekarte

### Requirement: Neue Person der Sichtungskategorie I

Wird eine Person neu mit Sichtungskategorie I erfasst oder auf sie hochgestuft, SHALL jeder mit dem
Modul Personen einen Hinweis erhalten.

#### Scenario: Hochstufung
- **WHEN** eine Person von Sichtungskategorie II auf I hochgestuft wird
- **THEN** erhalten alle mit dem Modul Personen einen Hinweis „Sichtung I“

### Requirement: Einheit oder Fahrzeug wieder verfügbar

Wechselt der Status einer Einheit oder eines Fahrzeugs in die Kategorie verfügbar aus einer anderen
Kategorie, SHALL die Nutzer von EL und S3 einen Hinweis erhalten. Andere Statuswechsel MUST still
bleiben.

#### Scenario: Fahrzeug einsatzbereit
- **WHEN** ein Fahrzeug von Status 3 (gebunden) auf Status 2 (verfügbar) wechselt
- **THEN** erhalten EL und S3 einen Hinweis „Wieder verfügbar“ mit dem Fahrzeug

#### Scenario: Wechsel innerhalb gebunden
- **WHEN** ein Fahrzeug von Status 3 auf Status 4 wechselt
- **THEN** erhält niemand eine Benachrichtigung

### Requirement: Chat-Erwähnung

Eine Chat-Nachricht SHALL Nutzer und Führungsfunktionen per `@` erwähnen können. Jeder erwähnte
Nutzer und jeder Nutzer einer erwähnten Funktion MUST einen Hinweis erhalten, sofern er den Kanal
sehen darf. Nachrichten ohne Erwähnung MUST still bleiben.

#### Scenario: Erwähnung einer Funktion
- **WHEN** eine Nachricht „@S4 bitte Verpflegung klären“ geschrieben wird
- **THEN** erhalten die Nutzer von S4 einen Hinweis „Erwähnt im Chat“ mit Sprung zur Nachricht

### Requirement: Aufnahme in einen Einsatz

Wird ein Nutzer in einen Einsatz aufgenommen, SHALL er einen Hinweis erhalten, auch wenn er gerade
keinen Einsatz geöffnet hat.

#### Scenario: Aufnahme außerhalb eines Einsatzes
- **WHEN** Person A auf der Einsatzliste steht und in den Einsatz „Hochwasser“ aufgenommen wird
- **THEN** erhält A einen Hinweis „Aufgenommen in Hochwasser“ mit Sprung in den Einsatz

### Requirement: Neuer Einsatz

Wird ein Einsatz angelegt, SHALL jede Führungskraft der Organisation, die ihn lesen darf, einen
Hinweis erhalten. Wer ihn nicht lesen darf, MUST NOT von ihm erfahren.

#### Scenario: Neuer Einsatz
- **WHEN** ein Einsatz angelegt wird, den Führungskraft F lesen darf und Führungskraft G nicht
- **THEN** erhält F einen Hinweis „Neuer Einsatz“, G nicht

### Requirement: Gemeinsames Budget und Bündelung

Alle Benachrichtigungen SHALL ein gemeinsames Budget teilen: höchstens drei einzelne Toasts sind
sichtbar, ab der vierten fasst ein Sammeltoast alle zusammen und nennt je Art die Zahl und einen
Sprung. Dieselbe Benachrichtigung MUST höchstens einmal erscheinen.

#### Scenario: Fünf Hinweise
- **WHEN** binnen kurzer Zeit zwei neue Aufträge, ein Befehl und zwei Nachforderungs-Hinweise eintreffen
- **THEN** zeigt die Oberfläche einen Sammeltoast „5 weitere …“ mit je einem Sprung zu Aufträge, Befehle und Nachforderungen

### Requirement: Quittieren gilt für alle Verbindungen des Nutzers

Schließt oder öffnet ein Nutzer den Toast einer Benachrichtigung, SHALL sie für ihn quittiert sein,
und ihre Toasts und OS-Meldungen MUST auf all seinen offenen Verbindungen verschwinden.

#### Scenario: Zwei Tabs
- **WHEN** Person A den Einsatz in zwei Tabs offen hat und den Toast „Neuer Auftrag“ im ersten schließt
- **THEN** verschwindet der Toast auch im zweiten Tab

### Requirement: Kategorien je Nutzer abschaltbar

Jeder Nutzer SHALL die Benachrichtigungen der Stufe Hinweis je Art abschalten können; die
Einstellung MUST auf dem Server liegen und auf allen seinen Geräten gelten. Benachrichtigungen der
Stufe Alarm MUST NOT abschaltbar sein. Eine abgeschaltete Art bleibt in Zählern und Listen sichtbar.

#### Scenario: Gefahren abgeschaltet
- **WHEN** Person A die Art „Neue Gefahr“ abschaltet und eine Gefahr eingetragen wird
- **THEN** erhält A weder Ton noch Toast noch OS-Meldung, auf keinem Gerät

#### Scenario: Alarm nicht abschaltbar
- **WHEN** Person A ihre Benachrichtigungs-Einstellungen öffnet
- **THEN** stehen Sofortmeldung, überfälliger Auftrag und fällige Ablösung als immer an, ohne Schalter

### Requirement: Native Meldung in der Desktop-App

In der Desktop-App SHALL eine Benachrichtigung bei verdecktem oder minimiertem Fenster als native
Meldung des Betriebssystems erscheinen. Ein Klick darauf MUST das Fenster nach vorn holen; dort
steht der Toast der Benachrichtigung mit seinem Sprung zum Bezug bereit.

#### Scenario: Fenster minimiert
- **WHEN** die Desktop-App minimiert ist und ein Alarm eintrifft
- **THEN** erscheint eine native Meldung, und ein Klick holt das Fenster nach vorn, wo der Toast mit „Öffnen“ steht

### Requirement: Verpasste Benachrichtigungen werden nachgereicht

Gleicht ein Tab nach einem Verbindungsverlust voll ab oder öffnet ein Nutzer einen Einsatz, SHALL
das Frontend die unquittierten Benachrichtigungen des Nutzers aus den letzten 12 Stunden zeigen, die
der Tab nicht schon zeigt, jeweils mit ihrer Uhrzeit. Nachgereichte Benachrichtigungen MUST höchstens einen
dezenten Ton auslösen, keinen Alarmton.

#### Scenario: Server-Neustart
- **WHEN** der Server neu startet, währenddessen ein Auftrag an Person A überfällig wird und A's Tab danach `lagged` erhält
- **THEN** zeigt A's Tab den Toast „Auftrag überfällig“ mit der Uhrzeit und spielt einmal den dezenten Ton

### Requirement: Gekoppelte Geräte bleiben still

Gekoppelte Geräte SHALL keine Benachrichtigungen erhalten und MUST NOT einen Ton spielen.

#### Scenario: Gerät mit Modul Meldungen
- **WHEN** eine Sofortmeldung eingeht und ein gekoppeltes Gerät der Ansicht Einsatzabschnitt den Einsatz zeigt
- **THEN** spielt das Gerät keinen Ton
