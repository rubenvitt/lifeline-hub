# benachrichtigungen Specification

## Purpose
Legt fest, welches Ereignis im Einsatz und in der Organisation wen benachrichtigt und wie laut,
damit die Führung erfährt, was sie betrifft, ohne selbst nachsehen zu müssen und ohne von
Fremdem überflutet zu werden.

## Requirements

### Requirement: Drei Stufen

Jede Benachrichtigung SHALL genau eine Stufe tragen. *Alarm*: lauter Ton, Toast, OS-Meldung bei
verdecktem Tab. *Hinweis* (Eingang): dezenter Ton, OS-Meldung bei verdecktem Tab, zählt als
ungelesener Eingang. *Still*: kein Ton, kein Toast, keine OS-Meldung; die Benachrichtigung steht
nur im Verlauf, schon gelesen, und zählt nie. Still wird eine Benachrichtigung für einen
Empfänger, der ihre Art abgeschaltet hat, oder für den die Vorgabe des Einsatzes sie still stellt
(„Vorgabe je Funktion am Einsatz“).
Toasts beider lauten Stufen MUST stehen bleiben, bis sie geschlossen oder geöffnet werden.
Hat der Nutzer Push auf einem Gerät eingeschaltet, SHALL eine Benachrichtigung beider lauten
Stufen dort auch bei geschlossener App als OS-Meldung erscheinen (Spec `web-push`).

#### Scenario: Hinweis im sichtbaren Tab
- **WHEN** eine Person mit sichtbarem Einsatz-Tab eine Benachrichtigung der Stufe Hinweis erhält
- **THEN** spielt der dezente Ton, ein Toast erscheint, und es entsteht keine OS-Meldung

#### Scenario: Alarm im verdeckten Tab
- **WHEN** eine Person mit verdecktem Einsatz-Tab und erlaubten OS-Meldungen einen Alarm erhält
- **THEN** spielt der laute Ton, ein Toast erscheint, und eine OS-Meldung erscheint

#### Scenario: Alarm bei geschlossener App
- **WHEN** eine Person mit eingeschaltetem Push auf ihrem Handy einen Alarm erhält und die App dort geschlossen ist
- **THEN** erscheint auf dem Handy eine OS-Meldung

#### Scenario: Stilles Ereignis
- **WHEN** eine Chat-Nachricht ohne Erwähnung eingeht
- **THEN** ändert sich nur der Zähler am Modul Chat; es gibt keinen Ton und keinen Toast

#### Scenario: Still für einen Empfänger
- **WHEN** Person A die Art „Neuer Auftrag“ abgeschaltet hat und ein Auftrag an sie erteilt wird
- **THEN** steht „Neuer Auftrag“ in ihrem Verlauf als gelesen, ohne Ton, ohne Hinweis und ohne dass die Zahl ihrer ungelesenen Eingänge steigt

### Requirement: Verlauf der Benachrichtigungen

Der Server SHALL je Person und Einsatz einen Verlauf ihrer Benachrichtigungen liefern, jüngste
zuerst, höchstens 200, mit Text, Zeit, Stufe und Sprungziel, und dazu die Zahl ihrer ungelesenen
Eingänge. Alarme und Stilles MUST NOT mitgezählt werden. Der Verlauf MUST dieselbe Rechteprüfung
wie das Lesen einer Benachrichtigung anwenden; nur wer den Einsatz lesen darf, erhält ihn.
Ungelesene Benachrichtigungen SHALL 24 Stunden im Verlauf bleiben, gelesene 24 Stunden nach dem
Lesen.

#### Scenario: Zwei Eingänge und ein Alarm
- **WHEN** Person A zwei Hinweise „Neuer Auftrag“ und einen Alarm „Auftrag überfällig“ erhalten hat
- **THEN** nennt ihr Verlauf alle drei, den Alarm zuerst, und zwei ungelesene Eingänge

#### Scenario: Recht am Modul verloren
- **WHEN** Person A das Modul Aufträge nicht mehr sehen darf
- **THEN** fehlen ihre Benachrichtigungen zu Aufträgen im Verlauf und in der Zahl

### Requirement: Alle gelesen

Eine Person SHALL ihre Benachrichtigungen eines Einsatzes bis zu einer Kennung auf einmal als
gelesen markieren können. Alarme MUST davon unberührt bleiben. Der Server MUST es ihren übrigen
Verbindungen mit genau einem Ereignis melden, gleich wie viele Benachrichtigungen es betrifft.

#### Scenario: Zwei Tabs
- **WHEN** Person A in einem Tab „Alle gelesen“ wählt und den Einsatz in einem zweiten Tab offen hat
- **THEN** zeigt auch der zweite Tab keine ungelesenen Eingänge mehr, und ein offener Alarm bleibt stehen

#### Scenario: Zweites Gerät
- **WHEN** Person A ihre Eingänge am Tablet gelesen hat und danach am Laptop den Einsatz öffnet
- **THEN** sind sie auch dort gelesen

### Requirement: Verlauf ohne Netz

Der Verlauf SHALL ohne Netz aus dem zuletzt geladenen Stand lesbar bleiben, auch nach einem
Neuladen, und dabei seinen Stand als offline kennzeichnen. „Alle gelesen“ SHALL ohne Netz auf dem
Gerät vorgemerkt werden: Die Zahl der ungelesenen Eingänge MUST sofort fallen und bis zum Senden
nicht zurückspringen, der Verlauf MUST „Offline vorgemerkt“ zeigen, und nach der Rückkehr des Netzes
MUST das System die Markierung ohne weiteres Zutun senden. Alarme MUST auch dabei unberührt
bleiben.

#### Scenario: Verlauf nach dem Neuladen ohne Netz
- **WHEN** Person A „Eingänge“ mit Netz geöffnet hat, das Netz wegfällt und sie neu lädt
- **THEN** zeigt „Eingänge“ die zuvor geladenen Einträge mit „Stand … · offline“

#### Scenario: Alle gelesen ohne Netz
- **WHEN** Person A ohne Netz „Alle gelesen“ wählt
- **THEN** zeigt der Knopf keine ungelesenen Eingänge mehr, der Verlauf zeigt „Offline vorgemerkt“,
  und ein offener Alarm bleibt unter „Neu“

#### Scenario: Rückkehr des Netzes
- **WHEN** Person A ohne Netz „Alle gelesen“ gewählt hat und das Netz zurückkehrt
- **THEN** sendet das System „Alle gelesen“ bis zur damals jüngsten Kennung, die Zahl springt
  dazwischen nicht zurück, und ihre anderen Geräte zeigen die Eingänge als gelesen
- **AND** was inzwischen eingegangen ist, bleibt ungelesen

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
- **THEN** erhalten alle mit dem Modul Meldungen außer dem Erfasser einen Alarm; die Benachrichtigung trägt den Titel „Sofortmeldung eingegangen“

#### Scenario: Eskalation
- **WHEN** eine Sofortmeldung unbestätigt bleibt und der Scheduler sie eskaliert
- **THEN** erhalten alle mit dem Modul Meldungen einschließlich des Erfassers einen Alarm „Bestätigung ausstehend“

### Requirement: Der Sofortalarm nennt die Meldung und springt zu ihr

Beide Alarme einer Sofortmeldung SHALL Absender und Anfang des Wortlauts der Meldung nennen;
beides MUST das Frontend über die Abfrage der Meldung holen, nie über das Live-Ereignis oder den
Text der Benachrichtigung. Antwortet die Abfrage nicht rechtzeitig, MUST der Alarm mit dem Text
der Benachrichtigung erscheinen. „Öffnen“ und der Klick auf die OS-Meldung MUST zur Meldung
springen und sie hervorheben.

#### Scenario: Inhalt im Alarm
- **WHEN** die Rettungsstaffel per Sofortmeldung „Kellerabgang Mühlbachweg 34: eine schwer verletzte Person geborgen“ meldet
- **THEN** heißt der Alarm „Sofortmeldung · Rettungsstaffel“ und zeigt den Anfang des Wortlauts, höchstens 120 Zeichen, den ganzen Wortlaut im Titel-Attribut

#### Scenario: Meldung nicht abrufbar
- **WHEN** die Abfrage der Meldung scheitert oder nicht rechtzeitig antwortet
- **THEN** erscheint der Alarm „Sofortmeldung eingegangen“ mit „Meldung #‹Nummer›“

#### Scenario: Öffnen
- **WHEN** eine Person im Alarm „Öffnen“ wählt oder die OS-Meldung anklickt
- **THEN** steht die Meldungsseite mit `?meldung=‹id›` offen und die Karte der Meldung ist hervorgehoben

### Requirement: Bestätigen sichtet die Sofortmeldung

Bestätigt eine Person eine Meldung mit Bestätigungspflicht, SHALL die Meldung in derselben
Transaktion vom Status Neu auf Gesichtet gehen: wer den Empfang bestätigt, hat sie gesehen. Ein
späterer Status (Gesichtet, In Bearbeitung, Erledigt) MUST unverändert bleiben.

#### Scenario: Neue Sofortmeldung bestätigt
- **WHEN** eine Sofortmeldung im Status Neu bestätigt wird
- **THEN** steht sie auf Gesichtet, trägt die Quittung und zählt nicht mehr als unbearbeitet

#### Scenario: Schon in Bearbeitung
- **WHEN** eine Sofortmeldung im Status In Bearbeitung bestätigt wird
- **THEN** bleibt sie In Bearbeitung

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

Ablösung (Vorwarnung als Hinweis, Fälligkeit als Alarm, an alle mit dem Modul Ablösung) SHALL ihr
bisheriges Verhalten behalten. Unwetter (an alle im Einsatz mit dem Modul Wetter & Pegel, im
Browser erkannt) SHALL ab der amtlichen Warnstufe rot (Unwetter, auch extremes Unwetter) ein Alarm
sein: lauter Ton, Toast, OS-Meldung bei verdecktem Tab, nicht abschaltbar (Katalog LLH-1142 E1,
LLH-1425). Geringere Warnstufen MUST NOT benachrichtigen. Beide unterliegen dem gemeinsamen Budget
der Benachrichtigungen.

#### Scenario: Ablösung fällig
- **WHEN** eine Schicht fällig wird
- **THEN** erhalten alle mit dem Modul Ablösung einen Alarm „Ablösung fällig“ wie bisher

#### Scenario: Unwetterwarnung rot
- **WHEN** für den Einsatzort eine neue amtliche Unwetterwarnung (Stufe rot) gilt und Person A die Unwetterwarnung früher abgeschaltet hatte
- **THEN** spielt bei A der laute Ton und ein Alarm „Unwetterwarnung“ erscheint mit Sprung zu Wetter & Pegel

#### Scenario: Markantes Wetter
- **WHEN** für den Einsatzort nur eine Warnung vor markantem Wetter (orange) gilt
- **THEN** erhält niemand eine Benachrichtigung; die Warnung steht auf der Seite Wetter & Pegel

### Requirement: Hinweise der Ablösung

Zwei weitere Arten der Ablösung (LLH-1131, Spec `kraefte-abloesung`) SHALL als Hinweis an alle
mit dem Modul Ablösung gehen: `abloesung_planung` („Keine ablösende Einheit geplant“, vom
Scheduler) und `abloesung_abloeser` (die geplante ablösende Einheit ist alarmiert, eingetroffen,
am Bereitstellungsraum eingetroffen oder abgerufen, ihre Planung ist entfallen, oder in der
Kräfte-Zeitachse ist die Alarmierung bzw. das Eintreffen gestrichen, mit dem ihre offene Periode
begann, LLH-1425). Das gilt für Statuswechsel wie für Nachträge in die Kräfte-Zeitachse; die
Streichung eines Ereignisses, zu dem es keinen Hinweis gab, MUST still bleiben. Bei
`abloesung_abloeser` MUST der Bezugstyp das Ereignis tragen und der Titel aus ihm folgen; der
Bezug ist die Schicht, der Sprung führt zur Seite Ablösung. Beide sind je Art abschaltbar und
MUST NOT eine weitere Stufe oder Einstufung bilden.

#### Scenario: Ablösende Einheit eingetroffen
- **WHEN** die geplante ablösende Einheit einer Schicht eintrifft und Person A den Status setzt
- **THEN** erhalten alle anderen mit dem Modul Ablösung einen Hinweis „Ablösende Einheit eingetroffen“, A und Personen ohne das Modul nicht

#### Scenario: Alarmierung gestrichen
- **WHEN** Person A die Alarmierung der geplanten ablösenden Einheit, mit der ihre offene Periode begann, in der Kräfte-Zeitachse streicht
- **THEN** erhalten alle anderen mit dem Modul Ablösung genau einen Hinweis „Alarmierung der ablösenden Einheit gestrichen“ mit Sprung zur Schicht

#### Scenario: Abgeschaltet
- **WHEN** Person B den Hinweis „Ablösende Einheit“ abgeschaltet hat
- **THEN** erhält B dafür keine Benachrichtigung, den Alarm „Ablösung fällig“ aber weiter

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
Verteiler eine Benachrichtigung erhalten, als Hinweis oder still nach der Vorgabe des Einsatzes
(„Vorgabe je Funktion am Einsatz“; ohne Festlegung ist der Lagebericht still). Verteiler vom Typ
Einheit, Abschnitt oder extern MUST NOT Nutzer benachrichtigen.

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

### Requirement: Eingang einer Meldung

Jede Meldung, die keine Sofortmeldung ist, SHALL beim Erfassen ohne Empfängerfunktion als
Hinweis „Neue Meldung“ alle Mitglieder mit Schreibrecht im Modul Meldungen erreichen, nie
Beobachter und nie den Erfasser. Eine dringende Meldung, jede Lagemeldung und jede Meldung von
einem gekoppelten Gerät MUST mit Empfängerfunktion stattdessen deren Nutzer und die
Einsatzleitung erreichen; eine normale Meldung mit Empfängerfunktion nur deren Nutzer (Anforderung
„Meldung an mich“). Eine Sofortmeldung bleibt bei ihrem Alarm.

#### Scenario: Dringende Meldung
- **WHEN** Person A eine dringende Meldung ohne Empfängerfunktion erfasst, B und C Führungspersonal sind und D Beobachterin
- **THEN** erhalten B und C den Hinweis „Neue Meldung“, A und D nicht

#### Scenario: Lagemeldung
- **WHEN** eine Meldung der Art Lagemeldung ohne Empfängerfunktion erfasst wird
- **THEN** erhalten alle mit Schreibrecht im Modul Meldungen außer dem Erfasser den Hinweis

#### Scenario: Meldung von einem gekoppelten Gerät
- **WHEN** der Laptop der UHS Nord eine Meldung mit Priorität normal erfasst
- **THEN** erhalten alle mit Schreibrecht im Modul Meldungen den Hinweis, das Gerät nicht

#### Scenario: Eingang mit Empfängerfunktion
- **WHEN** eine Lagemeldung mit Empfängerfunktion S2 erfasst wird, Person A S2 besetzt und Person C die Einsatzleitung
- **THEN** erhalten A und C den Hinweis, das übrige Führungspersonal nicht

#### Scenario: Normale Meldung von Hand
- **WHEN** Person A eine Meldung mit Priorität normal ohne Empfängerfunktion von Hand erfasst
- **THEN** erhalten alle anderen mit Schreibrecht im Modul Meldungen den Hinweis „Neue Meldung“, A und Beobachter nicht

### Requirement: In die Lage übernommen

Wird eine Meldung, die nicht die Art Lagemeldung hat, zum ersten Mal in die Lage übernommen,
SHALL ein Hinweis „In die Lage übernommen“ die Nutzer von S2 und die Einsatzleitung erreichen,
nicht den Übernehmenden. Der Hinweis gehört zur Art „Neue Meldung“, springt zu den Lagemeldungen
und MUST bei einer erneuten Übergabe derselben Meldung nicht noch einmal entstehen.

#### Scenario: Übernahme in die Lage
- **WHEN** Person B eine Meldung von Florian Nord 1 in die Lage übernimmt, Person A S2 besetzt und Person C die Einsatzleitung
- **THEN** erhalten A und C den Hinweis „In die Lage übernommen“ mit Sprung zu den Lagemeldungen, B nicht

#### Scenario: Zweite Übergabe
- **WHEN** dieselbe Meldung mit geändertem Lage-Text erneut übergeben wird
- **THEN** entsteht kein weiterer Hinweis

### Requirement: Sichten räumt den Hinweis bei allen

Geht eine Meldung aus dem Status Neu heraus (Sichten, Bestätigen, In Bearbeitung, Erledigt), SHALL
der Server ihre offenen Hinweise „Neue Meldung“ für alle Empfänger quittieren; ihre Toasts und
OS-Meldungen MUST auf allen Verbindungen verschwinden. Ebenso MUST die Kenntnisnahme einer
Lagemeldung die Hinweise „In die Lage übernommen“ zu ihr quittieren. Ein Alarm MUST davon
unberührt bleiben.

#### Scenario: Gesichtet in einem anderen Tab
- **WHEN** Person C eine dringende Meldung sichtet, zu der A und B einen Hinweis haben
- **THEN** ist der Hinweis bei A und B quittiert und verschwindet in jedem ihrer Tabs

#### Scenario: Kenntnisnahme räumt die Übernahme
- **WHEN** eine übernommene Lagemeldung als gesehen gekennzeichnet wird
- **THEN** sind die Hinweise „In die Lage übernommen“ zu ihr quittiert

#### Scenario: Sofortalarm bleibt
- **WHEN** eine Sofortmeldung auf In Bearbeitung gesetzt wird
- **THEN** bleiben ihre Alarme offen, bis jeder sie selbst quittiert

### Requirement: Eingangshinweis

Alle Eingänge eines Einsatzes (Stufe Hinweis, außer den Org-Arten) SHALL gebündelt in einem
stehenden Eingangsband erscheinen: unten, auf schmalen Schirmen über die Breite, ab dem
Tablet-Querformat rechts, getrennt von den Toasts oben. Das Band MUST NOT einen Platz der Toasts
belegen oder einen Toast verdrängen. Ein Eintrag einer Meldung MUST Absender und Anfang des
Wortlauts nennen (über die Abfrage der Meldung), ein anderer Eingang Titel und Detailzeile des
Servers; mehrere MUST als „‹n› neue Meldungen“ bzw., sind andere Eingänge dabei, „‹n› neue
Eingänge“ mit den jüngsten zwei Einträgen und der Zahl der übrigen erscheinen. Ein Eintrag
springt mit „Öffnen“ zum Objekt; mehrere aus einem Modul springen in das Modul, aus mehreren
Modulen öffnet „Ansehen“ den Verlauf, ohne zu quittieren. Je neue Meldung SHALL „Sichten“
bereitstehen, wenn die Person schreiben darf. Der dezente Ton MUST höchstens einmal je zwei
Minuten spielen.

#### Scenario: Zehn Meldungen in einer Minute
- **WHEN** binnen einer Minute zehn Lagemeldungen von Geräten eingehen
- **THEN** steht ein Hinweis „10 neue Meldungen“, und der dezente Ton spielt einmal

#### Scenario: Eingänge aus mehreren Modulen
- **WHEN** eine Meldung und zwei neue Aufträge eingehen
- **THEN** steht ein Band „3 neue Eingänge“, und „Ansehen“ öffnet den Verlauf am Knopf „Eingänge“, alle drei bleiben ungelesen

#### Scenario: Alle gelesen auf einem anderen Gerät
- **WHEN** Person A auf dem Telefon „Alle gelesen“ wählt, während am Laptop das Band steht
- **THEN** verschwindet das Band am Laptop, ein danach eingegangener Eintrag bleibt

#### Scenario: Sichten im Hinweis
- **WHEN** Person A im Hinweis bei einer Meldung „Sichten“ wählt
- **THEN** steht die Meldung auf Gesichtet, und der Eintrag verschwindet bei allen Empfängern

### Requirement: Der Eingangshinweis stört keine Eingabe

Während der Fokus in einem Eingabefeld steht, SHALL ein neuer Eintrag des Eingangshinweises
warten, bis das Feld verlassen wird. Auf der Seite Meldungen MUST der Hinweis keine Meldungen
zeigen, auf der Seite Lagemeldungen keine Übernahmen; dort trägt das Sammelbanner die Neuen.

#### Scenario: Während einer Eingabe
- **WHEN** eine dringende Meldung eingeht, während Person A im ETB tippt
- **THEN** erscheint der Hinweis erst, wenn A das Feld verlässt

#### Scenario: Auf der Meldungsseite
- **WHEN** eine dringende Meldung eingeht, während Person A die Seite Meldungen offen hat
- **THEN** erscheint kein Hinweis und kein Ton; das Sammelbanner der Seite trägt die Meldung

### Requirement: Das Eingangsband verdeckt keine untere Leiste

Steht am unteren Rand eine angepinnte Leiste (Erfassung des Einsatztagebuchs, Aktionsleiste des
Befehlsentwurfs, Speicherleiste einer Formularseite und jede weitere Fußleiste mit gemessenem
Fokusabstand), SHALL das Eingangsband über ihrer Oberkante stehen, sobald es sie sonst schnitte,
auf schmalen Schirmen wie ab dem Tablet-Querformat. Es MUST NOT ein Bedienelement einer solchen
Leiste verdecken; geht die Leiste, rückt es zurück an den Rand.

#### Scenario: Eingang während der Erfassung im ETB
- **WHEN** eine Meldung eingeht, während Person A das Einsatztagebuch offen hat
- **THEN** steht das Band über der Erfassung, und „Erfassen“ bleibt sichtbar und klickbar

#### Scenario: Eingang am Befehlsentwurf auf dem Handschirm
- **WHEN** eine Meldung eingeht, während Person A einen Befehl auf dem Handschirm bearbeitet
- **THEN** steht das Band über der Aktionsleiste, „Entwurf speichern“ und „Freigeben“ bleiben frei

### Requirement: Ungelesene Eingänge im Tab-Titel

Der Tab-Titel eines Einsatzes SHALL die Zahl der ungelesenen Eingänge der angemeldeten Person
voranstellen, „(3) Lagekarte · Einsatz · lifeline-hub“: dieselbe Zahl wie am Knopf „Eingänge“
(Stufe Hinweis, nicht quittiert; Alarme und Stilles zählen nicht). Wo der Browser es kann, MUST
dieselbe Zahl am Symbol der installierten App stehen. Ohne ungelesene Eingänge entfällt die Zahl.
Der Knopf „Eingänge“ MUST die Zahl auch im zugänglichen Namen tragen („Eingänge, 3 ungelesen“),
nie nur als Ziffer. Bündelt der Kopf die Alarmzentrale zu einem Ziel (Handschirm, Tablet mit
Finger), SHALL dieses Ziel die Zahl und einen Eintrag „Eingänge“ tragen statt eines eigenen
Knopfs; der Kopf MUST dadurch nicht umbrechen.

#### Scenario: Stiller Eingang
- **WHEN** drei Meldungen mit Priorität normal von Hand erfasst werden und Person B keine davon geöffnet hat
- **THEN** beginnt Bs Tab-Titel mit „(3)“, und der Knopf „Eingänge“ heißt „Eingänge, 3 ungelesen“

#### Scenario: Gelesen auf einem anderen Gerät
- **WHEN** Person B auf dem Telefon „Alle gelesen“ wählt
- **THEN** entfällt die Zahl auch im Tab-Titel ihres Laptops, ohne Neuladen

### Requirement: Lagemeldung schlägt S2 vor

Wählt eine Person im Meldungsformular die Art Lagemeldung, SHALL das Formular die
Empfängerfunktion S2 vorschlagen, solange keine Funktion gewählt und das Feld unberührt ist. Den
freien Empfängertext MUST der Vorschlag unverändert lassen.

#### Scenario: Lagemeldung erfassen
- **WHEN** eine Person „Lagemeldung (extern)“ wählt und erfasst
- **THEN** geht die Meldung mit Empfängerfunktion S2 und leerem freien Empfänger hinaus

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
- **WHEN** eine Nachforderung von Person A über zwei Einheiten an die Leitstelle auf eingetroffen wechselt
- **THEN** erhalten A und S4 einen Hinweis „Nachforderung eingetroffen“ mit der Zeile „2× an Leitstelle“

### Requirement: Neue Gefahr

Wird eine Gefahr neu eingetragen, SHALL jeder mit dem Modul Lagekarte einen Hinweis „Neue Gefahr“
erhalten. Änderungen an bestehenden Gefahren MUST still bleiben.

#### Scenario: Gefahr eingetragen
- **WHEN** eine Gefahr „Gasaustritt“ neu eingetragen wird
- **THEN** erhalten alle mit dem Modul Lagekarte einen Hinweis mit Sprung zur Gefahr auf der Lagekarte

### Requirement: Neue Person der Sichtungskategorie I

Wird eine Person neu mit Sichtungskategorie I erfasst oder auf sie hochgestuft, SHALL jeder mit dem
Modul Personen einen Hinweis erhalten. Eine nachgereichte ältere Sichtung, die nicht zur aktuellen
wird, und die zweite Übertragung eines schon gespeicherten Eintrags MUST keinen Hinweis auslösen.

#### Scenario: Hochstufung
- **WHEN** eine Person von Sichtungskategorie II auf I hochgestuft wird
- **THEN** erhalten alle mit dem Modul Personen einen Hinweis „Sichtung I“

#### Scenario: Ältere Sichtung I kommt nach
- **WHEN** eine offline vorgemerkte SK I ankommt, die älter ist als die aktuelle SK II der Person
- **THEN** entsteht kein Hinweis „Sichtung I“

### Requirement: Vermisstenmeldung

Wird eine Person mit Status vermisst erfasst oder wechselt ihr Status auf vermisst, SHALL jeder mit
dem Modul Personen außer dem Auslöser einen Alarm „Vermisstenmeldung“ erhalten (Katalog LLH-1142
E1, LLH-1425). Bezug ist die Person, der Text nennt nur ihre Registriernummer. Je Wechsel MUST
genau ein Alarm entstehen: die zweite Übertragung einer schon gespeicherten Anlage und ein
gleichzeitiger zweiter Wechsel (409) lösen keinen aus.

#### Scenario: Person auf vermisst gesetzt
- **WHEN** Person A eine erfasste Person auf vermisst setzt
- **THEN** erhalten alle anderen mit dem Modul Personen einen Alarm „Vermisstenmeldung“ mit „Person R-001“ und Sprung zur Person

#### Scenario: Person als vermisst erfasst
- **WHEN** eine Person offline mit Status vermisst erfasst und die Anlage zweimal übertragen wird
- **THEN** entsteht genau ein Alarm

#### Scenario: Wiedergefunden und erneut vermisst
- **WHEN** eine vermisste Person auf betroffen und später wieder auf vermisst wechselt
- **THEN** entsteht beim zweiten Wechsel auf vermisst ein neuer Alarm, beim Wechsel auf betroffen keiner

### Requirement: Rückmeldung überfällig

Ist die letzte Rückmeldung einer Einheit (die jüngste an sie gebundene Meldung) älter als die
wirksame Rückmeldefrist (Einsatz vor Organisation vor 60 Minuten), SHALL jeder, der im Einsatz
Meldungen bearbeiten darf, einen Hinweis „Rückmeldung überfällig“ mit der Einheit erhalten (Katalog
LLH-1142 E1, LLH-1425). Die Prüfung macht der Erinnerungs-Scheduler. Je Überfälligkeit MUST genau
ein Hinweis entstehen, nicht einer je Takt; erst eine neue Rückmeldung, die ihrerseits überfällig
wird, löst den nächsten aus. Einheiten ohne jede Rückmeldung, aufgelöste Einheiten und
abgeschlossene Einsätze MUST still bleiben. Beim Import der Demo-Daten gelten schon überfällige
Rückmeldungen als gemeldet.

#### Scenario: Frist überschritten
- **WHEN** der 1. Zug sich um 08:00 zurückgemeldet hat, die Frist 60 Minuten beträgt und es 09:00 wird
- **THEN** erhalten alle, die Meldungen bearbeiten, einen Hinweis „Rückmeldung überfällig“ mit „1. Zug“ und Sprung zur Einheit

#### Scenario: Weitere Takte
- **WHEN** der Scheduler danach weiter läuft und keine neue Rückmeldung kommt
- **THEN** entsteht kein weiterer Hinweis

#### Scenario: Neue Rückmeldung
- **WHEN** der 1. Zug sich um 10:00 erneut zurückmeldet und bis 11:00 nichts mehr kommt
- **THEN** entsteht um 11:00 genau ein neuer Hinweis

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

Alarme, Org-Hinweise und die Unwetterwarnung SHALL ein gemeinsames Budget teilen: höchstens drei
einzelne Toasts sind sichtbar. Ab der vierten fasst ein Sammeltoast die älteren zusammen und nennt
je Art die Zahl und einen Sprung; die jüngste bleibt einzeln stehen. Dieselbe Benachrichtigung
MUST höchstens einmal erscheinen. Eingänge eines Einsatzes stehen im Eingangsband und MUST NOT
einen Platz des Budgets belegen.

#### Scenario: Fünf Alarme
- **WHEN** binnen kurzer Zeit zwei überfällige Aufträge, eine Sofortmeldung und zwei fällige Ablösungen eintreffen
- **THEN** steht der jüngste einzeln, und ein Sammeltoast „4 weitere Alarme“ nennt die übrigen mit je einem Sprung zu Aufträge, Meldungen und Ablösung

#### Scenario: Eingang neben drei Alarmen
- **WHEN** drei Alarme einzeln stehen und eine Meldung eingeht
- **THEN** stehen die drei weiter einzeln, und die Meldung erscheint im Eingangsband

### Requirement: Quittieren gilt für alle Verbindungen des Nutzers

Schließt oder öffnet ein Nutzer den Toast einer Benachrichtigung, SHALL sie für ihn quittiert sein,
und ihre Toasts und OS-Meldungen MUST auf all seinen offenen Verbindungen verschwinden.

#### Scenario: Zwei Tabs
- **WHEN** Person A den Einsatz in zwei Tabs offen hat und den Toast „Auftrag überfällig“ im ersten schließt
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
- **THEN** stehen Sofortmeldung, überfälliger Auftrag, fällige Ablösung, Vermisstenmeldung und Unwetterwarnung als immer an, ohne Schalter

### Requirement: Vorgabe je Funktion am Einsatz

Wer den Einsatz verwalten darf (Einsatzleitung, Führungspersonal, Admin der Organisation des
Einsatzes), SHALL je Einsatz für jede Benachrichtigungsart der Stufe Hinweis festlegen können, für
welche Führungsfunktionen (EL, S1–S7, Führungshilfspersonal, Fachberater) und für Mitglieder ohne
Funktion sie still ist; Org-Arten und die Unwetterwarnung sind ausgenommen. Ohne Festlegung gilt
die Vorgabe des Katalogs: „Neuer Lagebericht“ still, alle übrigen Eingang. Die Funktionen eines
Empfängers sind seine Stab-Besetzung (EL über die Führungsstelle, ein Sachgebiet „bei der
Einsatzleitung“ zählt für den Einsatzleiter) und die Funktion seiner Mitgliedschaft; hat er keine,
gilt „ohne Funktion“. Ein Empfänger MUST eine Art still erhalten, wenn die Vorgabe sie für jede
seiner Funktionen still stellt; hat er eine Funktion, für die sie Eingang ist, MUST er sie als
Eingang erhalten (lauter gewinnt; die eigene Abschaltung bleibt davon unberührt). Arten der Stufe
Alarm MUST NOT per Vorgabe einstellbar sein (422). Eine Änderung MUST live bei allen erscheinen,
die die Einstellungen offen haben; ein abgeschlossener Einsatz MUST sie ablehnen (409).

#### Scenario: Still für S2
- **WHEN** die Vorgabe „Neuer Auftrag“ für S2 still stellt und ein Auftrag an S2 erteilt wird
- **THEN** steht er im Verlauf der S2 als gelesen und erhöht ihre Zahl ungelesener Eingänge nicht

#### Scenario: Zwei Funktionen
- **WHEN** Person A ist S2 und S4, die Vorgabe stellt „Neuer Auftrag“ nur für S2 still, und ein Auftrag geht an S2 und S4
- **THEN** erhält A den Auftrag als Eingang

#### Scenario: Lagebericht ohne Festlegung
- **WHEN** an einem Einsatz ohne Festlegung ein Lagebericht freigegeben wird
- **THEN** steht er bei allen Empfängern still im Verlauf

#### Scenario: Alarm nicht einstellbar
- **WHEN** jemand die Vorgabe für „Sofortmeldung“ setzen will
- **THEN** lehnt der Server mit 422 ab, und die Sektion „Benachrichtigungen“ bietet die Art nicht an

### Requirement: Stumm auf diesem Gerät

Eine Person SHALL Eingangsarten auf einem Gerät stumm schalten können (Knopf „Stumm“ im Verlauf am
Knopf „Eingänge“). Auf diesem Gerät MUST eine stumme Art keinen Ton, keinen Eintrag im
Eingangsband und keine OS-Meldung des offenen Tabs auslösen; Zahl, Tab-Titel, App-Badge und
Verlauf MUST unverändert bleiben. Die Einstellung liegt im Browserspeicher des Geräts, ohne
Personenbezug, und bleibt beim Abmelden. Andere Geräte und andere Personen MUST NOT betroffen
sein. Alarme MUST NOT stumm schaltbar sein. Push bei geschlossener App (Spec `web-push`) folgt
der Einstellung nicht.

#### Scenario: Tablet stumm, Rechner laut
- **WHEN** Person A „Neue Meldung“ auf dem Tablet stumm schaltet und eine Meldung eingeht
- **THEN** zeigt das Tablet nur die höhere Zahl am Knopf „Eingänge“, der Rechner von A spielt den Ton und zeigt das Band

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
