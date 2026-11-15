# Spec Delta

## ADDED Requirements

### Requirement: Alarmzone verdeckt nichts

Alarme, Org-Hinweise und die Unwetterwarnung SHALL in einer Alarmzone direkt unter dem Kopf des
Rahmens stehen (unter einem Übungsband), die beim Rollen unter dem Rahmen klebt. Die Zone MUST den
Inhalt nach unten schieben statt ihn zu überlagern und MUST unter Drawer, Dialogen und Menüs
liegen. Ohne anstehenden Eintrag MUST sie keinen Platz belegen. Ein Eintrag MUST eine Zeile sein:
Stufe, Titel, Gegenstand, Uhrzeit und seine Handlungen.

#### Scenario: Alarm über einer Seitenaktion
- **WHEN** am Fükw bei 1440 × 900 auf der Seite Aufträge ein Alarm „Auftrag überfällig“ eintrifft
- **THEN** steht er in einer Zeile unter dem Kopf, und „Auftrag erteilen“ bleibt sichtbar und klickbar

#### Scenario: Drawer und Dialog liegen darüber
- **WHEN** ein Alarm ansteht und der Nutzer einen Dialog oder den Navigations-Drawer öffnet
- **THEN** liegen Dialog bzw. Drawer über der Alarmzone, und jeder Eintrag darin ist klickbar

#### Scenario: Ruhe
- **WHEN** kein Alarm, Org-Hinweis oder Unwetterhinweis ansteht
- **THEN** steht keine Alarmzone, und der Inhalt beginnt direkt unter dem Kopf

### Requirement: Ausblenden quittiert nicht

Das Schließkreuz an einem Eintrag der Alarmzone, an der gebündelten Zone und am Eingangsband SHALL
nur ausblenden: Die Benachrichtigung MUST unquittiert bleiben und MUST im Verlauf „Eingänge“ unter
„Neu“ stehen. Ein ausgeblendeter Eintrag MUST in diesem Tab weg bleiben, auch nach dem Neuladen und
beim Nachreichen, bis der Tab geschlossen wird; andere Tabs und Geräte zeigen ihn weiter. Quittiert wird mit „Öffnen“ und „Gelesen“.

#### Scenario: Alarm wegräumen
- **WHEN** Person A den Alarm „Auftrag überfällig“ mit ✕ ausblendet
- **THEN** verschwindet er aus der Zone, bleibt unquittiert, und der Verlauf „Eingänge“ zeigt ihn unter „Neu“

#### Scenario: Neuladen nach dem Ausblenden
- **WHEN** Person A einen Alarm ausgeblendet hat und den Tab neu lädt
- **THEN** erscheint er in diesem Tab nicht wieder; in einem anderen Tab desselben Nutzers steht er weiter

#### Scenario: Duplizierter Tab
- **WHEN** Person A einen Tab dupliziert, in dem sie einen Alarm ausgeblendet hat
- **THEN** übernimmt der neue Tab das Ausblenden (bekannte Ausnahme, Entscheidung 15.11.2026)

#### Scenario: Gelesen
- **WHEN** Person A an einem Alarm „Gelesen“ wählt
- **THEN** ist die Benachrichtigung quittiert, die Seite bleibt, und der Alarm verschwindet auf all ihren Verbindungen

#### Scenario: Unwetterwarnung
- **WHEN** eine Unwetterwarnung in der Zone steht
- **THEN** trägt sie „Öffnen“ und ✕, aber kein „Gelesen“, weil keine Benachrichtigung dahinter steht

### Requirement: Eine Leiste am Handschirm

Unter `md` SHALL im Einsatz statt Alarmzone und Eingangsband eine Leiste von höchstens 48 px unten
stehen, sobald ein Eintrag der Zone ansteht oder ein Eingang neu eingeht. Sie nennt Alarme,
Hinweise und die Zahl der ungelesenen Eingänge wie der Knopf „Eingänge“. Ein Tipp MUST das Blatt
„Alarme und Eingänge“ von unten öffnen. Steht der Fokus in einem Eingabefeld, MUST die Leiste einklappen; steht
ein Alarm an, MUST sie stattdessen als eine Zeile mit diesem Alarm stehen bleiben.

#### Scenario: Leiste im ETB
- **WHEN** bei 390 × 844 im ETB ein Alarm und drei Eingänge anstehen
- **THEN** steht über der Erfassung eine Leiste „1 Alarm · 3 Eingänge“ von höchstens 48 px, und mindestens zwei Einträge der Zeitachse liegen vollständig darüber

#### Scenario: Tippen ohne Alarm
- **WHEN** nur Eingänge anstehen und Person A in die Erfassung des ETB tippt
- **THEN** ist die Leiste eingeklappt und erscheint wieder, wenn das Feld verlassen wird

#### Scenario: Tippen mit Alarm
- **WHEN** ein Alarm ansteht und Person A in ein Eingabefeld tippt
- **THEN** bleibt eine Zeile mit dem Alarm stehen, höchstens 48 px hoch

#### Scenario: Blatt öffnen
- **WHEN** Person A auf die Leiste tippt
- **THEN** öffnet sich von unten das Blatt „Alarme und Eingänge“, oben die Alarme mit „Öffnen“, „Gelesen“ und ✕, darunter die Eingänge

#### Scenario: Hinweis der Organisation am Handschirm
- **WHEN** im Einsatz bei 390 × 844 der Hinweis „Neuer Einsatz“ eingeht
- **THEN** nennt die Leiste „1 Hinweis“, nicht „Alarm“, und klappt beim Tippen ein

### Requirement: Der Verlauf nennt den Inhalt einer Meldung

Ein ungelesener Eintrag im Verlauf „Eingänge“ (unter „Neu“), der eine Meldung betrifft
(Sofortmeldung, Eskalation, neue Meldung, Übernahme in die Lage), SHALL wie Alarm und Eingangsband
Absender und Anfang des Wortlauts nennen, geholt über die Abfrage der Meldung; eine fällige
Erinnerung ihren Titel. Antwortet die Abfrage nicht rechtzeitig, MUST der Eintrag mit dem Text der
Benachrichtigung stehen, und das nächste Öffnen MUST erneut fragen. Unter „Früher“ steht der Text
der Benachrichtigung.

#### Scenario: Eskalation im Verlauf
- **WHEN** Person A den Verlauf öffnet und darin „Bestätigung ausstehend“ zur Sofortmeldung von RTW 2 unter „Neu“ steht
- **THEN** lautet der Eintrag „Bestätigung ausstehend · RTW 2“ mit dem Anfang des Wortlauts

#### Scenario: Meldung erst später abrufbar
- **WHEN** die Abfrage der Meldung beim ersten Öffnen scheitert und beim nächsten Öffnen antwortet
- **THEN** nennt der Eintrag beim nächsten Öffnen Absender und Wortlaut

## MODIFIED Requirements

### Requirement: Benachrichtigungen ohne sensible Nutzlast

Das Live-Ereignis einer Benachrichtigung SHALL nur Kennungen tragen (Benachrichtigung, Einsatz,
Art, Stufe, Bezugsobjekt). Den anzuzeigenden Text MUST das Frontend über eine Abfrage holen, die
nur dem Empfänger antwortet.

#### Scenario: Toast-Text
- **WHEN** eine Benachrichtigung „Auftrag #12 an S4“ zugestellt wird
- **THEN** enthält das Live-Ereignis keinen Auftragstext, und der Eintrag in der Alarmzone zeigt den Text aus der Abfrage

#### Scenario: Fremde Abfrage
- **WHEN** Person B die Benachrichtigung von Person A per Kennung abfragt
- **THEN** antwortet der Server mit 404

### Requirement: Ablösung und Unwetter bleiben, wie sie sind

Ablösung (Vorwarnung als Hinweis, Fälligkeit als Alarm, an alle mit dem Modul Ablösung) SHALL ihr
bisheriges Verhalten behalten; Schichten, die laut Schichtplan zum selben Zeitpunkt fällig sind,
MUST sich je Zeitpunkt einmal melden (Spec `kraefte-schichtplan`, „Ein Hinweis je Zeitpunkt“).
Unwetter (an alle im Einsatz mit dem Modul Wetter & Pegel, im
Browser erkannt) SHALL ab der amtlichen Warnstufe rot (Unwetter, auch extremes Unwetter) ein Alarm
sein: lauter Ton, Eintrag in der Alarmzone, OS-Meldung bei verdecktem Tab, nicht abschaltbar (Katalog LLH-1142 E1,
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

### Requirement: Sichten räumt den Hinweis bei allen

Geht eine Meldung aus dem Status Neu heraus (Sichten, Bestätigen, In Bearbeitung, Erledigt), SHALL
der Server ihre offenen Hinweise „Neue Meldung“ für alle Empfänger quittieren; ihre Einträge und
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

### Requirement: Kategorien je Nutzer abschaltbar

Jeder Nutzer SHALL die Benachrichtigungen der Stufe Hinweis je Art abschalten können; die
Einstellung MUST auf dem Server liegen und auf allen seinen Geräten gelten. Benachrichtigungen der
Stufe Alarm MUST NOT abschaltbar sein. Eine abgeschaltete Art bleibt in Zählern und Listen sichtbar.

#### Scenario: Gefahren abgeschaltet
- **WHEN** Person A die Art „Neue Gefahr“ abschaltet und eine Gefahr eingetragen wird
- **THEN** erhält A weder Ton noch Eintrag noch OS-Meldung, auf keinem Gerät

#### Scenario: Alarm nicht abschaltbar
- **WHEN** Person A ihre Benachrichtigungs-Einstellungen öffnet
- **THEN** stehen Sofortmeldung, überfälliger Auftrag, fällige Ablösung, Vermisstenmeldung und Unwetterwarnung als immer an, ohne Schalter

### Requirement: Native Meldung in der Desktop-App

In der Desktop-App SHALL eine Benachrichtigung bei verdecktem oder minimiertem Fenster als native
Meldung des Betriebssystems erscheinen. Ein Klick darauf MUST das Fenster nach vorn holen; dort
steht der Eintrag der Benachrichtigung in der Alarmzone mit seinem Sprung zum Bezug bereit.

#### Scenario: Fenster minimiert
- **WHEN** die Desktop-App minimiert ist und ein Alarm eintrifft
- **THEN** erscheint eine native Meldung, und ein Klick holt das Fenster nach vorn, wo der Eintrag mit „Öffnen“ in der Alarmzone steht

### Requirement: Gekoppelte Geräte bleiben still

Gekoppelte Geräte SHALL keine Benachrichtigungen erhalten und MUST NOT einen Ton spielen. Einzige Ausnahme ist das Gerät der Ansicht Einheit (LLH-1579): Es SHALL kurz vibrieren, wenn ein neuer Auftrag an die eigene Einheit eingeht, und spielt auch dann keinen Ton. Andere Ereignisse, auch Aufträge an andere Empfänger, lösen keine Vibration aus.

#### Scenario: Gerät mit Modul Meldungen
- **WHEN** eine Sofortmeldung eingeht und ein gekoppeltes Gerät der Ansicht Einsatzabschnitt den Einsatz zeigt
- **THEN** spielt das Gerät keinen Ton

#### Scenario: Einheitengerät bei neuem Auftrag
- **WHEN** die Einsatzleitung einen Auftrag an die Einheit erteilt, an die ein Gerät der Ansicht Einheit gekoppelt ist
- **THEN** vibriert das Gerät einmal kurz
- **AND** spielt keinen Ton und zeigt keinen Eintrag in der Alarmzone

#### Scenario: Einheitengerät beim Öffnen
- **WHEN** das Einheitengerät startet oder neu lädt und bereits offene Aufträge an die Einheit bestehen
- **THEN** vibriert es nicht

### Requirement: Drei Stufen

Jede Benachrichtigung SHALL genau eine Stufe tragen. *Alarm*: lauter Ton, Eintrag in der
Alarmzone, OS-Meldung bei verdecktem Tab. *Hinweis* (Eingang): dezenter Ton, OS-Meldung bei
verdecktem Tab, zählt als ungelesener Eingang. *Still*: kein Ton, kein Eintrag in Alarmzone oder
Eingangsband, keine OS-Meldung; die Benachrichtigung steht nur im Verlauf, schon gelesen, und zählt
nie. Still wird eine Benachrichtigung für einen Empfänger, der ihre Art abgeschaltet hat, oder für
den die Vorgabe des Einsatzes sie still stellt („Vorgabe je Funktion am Einsatz“).
Einträge beider lauten Stufen MUST stehen bleiben, bis sie geöffnet, als gelesen markiert oder
ausgeblendet werden.
Hat der Nutzer Push auf einem Gerät eingeschaltet, SHALL eine Benachrichtigung beider lauten
Stufen dort auch bei geschlossener App als OS-Meldung erscheinen (Spec `web-push`).

#### Scenario: Hinweis im sichtbaren Tab
- **WHEN** eine Person mit sichtbarem Einsatz-Tab eine Benachrichtigung der Stufe Hinweis erhält
- **THEN** spielt der dezente Ton, ein Eintrag im Eingangsband erscheint, und es entsteht keine OS-Meldung

#### Scenario: Alarm im verdeckten Tab
- **WHEN** eine Person mit verdecktem Einsatz-Tab und erlaubten OS-Meldungen einen Alarm erhält
- **THEN** spielt der laute Ton, ein Eintrag in der Alarmzone erscheint, und eine OS-Meldung erscheint

#### Scenario: Alarm bei geschlossener App
- **WHEN** eine Person mit eingeschaltetem Push auf ihrem Handy einen Alarm erhält und die App dort geschlossen ist
- **THEN** erscheint auf dem Handy eine OS-Meldung

#### Scenario: Stilles Ereignis
- **WHEN** eine Chat-Nachricht ohne Erwähnung eingeht
- **THEN** ändert sich nur der Zähler am Modul Chat; es gibt keinen Ton und keinen Eintrag in Alarmzone oder Eingangsband

#### Scenario: Still für einen Empfänger
- **WHEN** Person A die Art „Neuer Auftrag“ abgeschaltet hat und ein Auftrag an sie erteilt wird
- **THEN** steht „Neuer Auftrag“ in ihrem Verlauf als gelesen, ohne Ton, ohne Hinweis und ohne dass die Zahl ihrer ungelesenen Eingänge steigt

### Requirement: Fällige Erinnerung erreicht ihre Empfänger

Wird eine Erinnerung fällig, SHALL sie als Hinweis die Nutzer ihrer Empfängerfunktion erreichen;
ist keine Empfängerfunktion gesetzt, ihren Ersteller. Erinnerungen mit Bezug Meldung oder
Ablösung MUST weiter nicht als eigene Erinnerung benachrichtigen. Der Hinweis SHALL den Titel der
Erinnerung nennen; den MUST das Frontend über die Liste der offenen Erinnerungen holen, nie über
das Live-Ereignis oder den Text der Benachrichtigung. Ist der Titel nicht rechtzeitig da, MUST der
Hinweis mit dem Text der Benachrichtigung erscheinen.

#### Scenario: Erinnerung an S1
- **WHEN** eine Erinnerung „Pegel prüfen“ mit Empfängerfunktion S1 fällig wird
- **THEN** erhalten die Nutzer von S1 einen Hinweis „Erinnerung fällig: Pegel prüfen“, andere nicht

#### Scenario: Erinnerung ohne Empfänger
- **WHEN** eine Erinnerung ohne Empfängerfunktion fällig wird
- **THEN** erhält ihr Ersteller den Hinweis

#### Scenario: Titel nicht abrufbar
- **WHEN** die Liste der offenen Erinnerungen nicht rechtzeitig antwortet
- **THEN** erscheint der Hinweis „Erinnerung fällig“ ohne Titel

### Requirement: Eingangshinweis

Alle Eingänge eines Einsatzes (Stufe Hinweis, außer den Org-Arten) SHALL gebündelt in einem
stehenden Eingangsband erscheinen: ab `md` unten rechts, getrennt von der Alarmzone oben; unter
`md` trägt sie die Leiste am Handschirm („Eine Leiste am Handschirm“). Das Band MUST NOT einen
Platz der Alarmzone belegen oder einen Alarm verdrängen. Ein Eintrag einer Meldung MUST Absender
und Anfang des Wortlauts nennen (über die Abfrage der Meldung), eine fällige Erinnerung ihren
Titel, ein anderer Eingang Titel und Detailzeile des Servers; mehrere MUST als „‹n› neue
Meldungen“ bzw., sind andere Eingänge dabei, „‹n› neue Eingänge“ mit den jüngsten zwei Einträgen
und der Zahl der übrigen erscheinen. Ein Eintrag springt mit „Öffnen“ zum Objekt; mehrere aus
einem Modul springen in das Modul, aus mehreren Modulen öffnet „Ansehen“ den Verlauf, ohne zu
quittieren. ✕ blendet das Band aus, ohne zu quittieren. Je neue Meldung SHALL „Sichten“
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

#### Scenario: Band ausblenden
- **WHEN** Person A das Band „3 neue Eingänge“ mit ✕ ausblendet
- **THEN** verschwindet es, und die Zahl am Knopf „Eingänge“ bleibt 3

### Requirement: Der Eingangshinweis stört keine Eingabe

Während der Fokus in einem Eingabefeld steht, SHALL ein neuer Eintrag des Eingangshinweises
warten, bis das Feld verlassen wird; am Handschirm klappt die Leiste währenddessen ein, außer ein
Alarm steht an („Eine Leiste am Handschirm“). Auf der Seite Meldungen MUST der Hinweis keine
Meldungen zeigen, auf der Seite Lagemeldungen keine Übernahmen; dort trägt das Sammelbanner die
Neuen.

#### Scenario: Während einer Eingabe
- **WHEN** eine dringende Meldung eingeht, während Person A im ETB tippt
- **THEN** erscheint der Hinweis erst, wenn A das Feld verlässt

#### Scenario: Auf der Meldungsseite
- **WHEN** eine dringende Meldung eingeht, während Person A die Seite Meldungen offen hat
- **THEN** erscheint kein Hinweis und kein Ton; das Sammelbanner der Seite trägt die Meldung

### Requirement: Das Eingangsband verdeckt keine untere Leiste

Steht am unteren Rand eine angepinnte Leiste (Erfassung des Einsatztagebuchs, Aktionsleiste des
Befehlsentwurfs, Speicherleiste einer Formularseite und jede weitere Fußleiste mit gemessenem
Fokusabstand), SHALL das Eingangsband ab `md` und die Leiste am Handschirm über ihrer Oberkante
stehen, sobald sie sie sonst schnitten. Sie MUST NOT ein Bedienelement einer solchen Leiste
verdecken; geht die Leiste, rücken sie zurück an den Rand.

#### Scenario: Eingang während der Erfassung im ETB
- **WHEN** eine Meldung eingeht, während Person A das Einsatztagebuch offen hat
- **THEN** steht das Band bzw. am Handschirm die Leiste über der Erfassung, und „Erfassen“ bleibt sichtbar und klickbar

#### Scenario: Eingang am Befehlsentwurf auf dem Handschirm
- **WHEN** eine Meldung eingeht, während Person A einen Befehl auf dem Handschirm bearbeitet
- **THEN** steht die Leiste über der Aktionsleiste, „Entwurf speichern“ und „Freigeben“ bleiben frei

### Requirement: Gemeinsames Budget und Bündelung

Alarme, Org-Hinweise und die Unwetterwarnung SHALL sich die Alarmzone teilen. Steht ein Eintrag
an, zeigt sie ihn als Zeile. Ab zwei Einträgen MUST sie gebündelt stehen: eingeklappt der jüngste
mit „+ ‹n› weitere“, aufgeklappt eine Kopfzeile mit der Zahl und je Art der Zahl, darunter je
Eintrag eine Zeile mit seinen Handlungen. Dieselbe Benachrichtigung MUST höchstens einmal
erscheinen. Eingänge eines Einsatzes stehen im Eingangsband und MUST NOT in der Alarmzone stehen.

#### Scenario: Fünf Alarme
- **WHEN** binnen kurzer Zeit zwei überfällige Aufträge, eine Sofortmeldung und zwei fällige Ablösungen eintreffen
- **THEN** zeigt die Zone den jüngsten mit „+ 4 weitere“, und aufgeklappt nennt die Kopfzeile „5 Alarme“ mit „2 × Auftrag überfällig“, „1 × Sofortmeldung“ und „2 × Ablösung fällig“

#### Scenario: Eingang neben drei Alarmen
- **WHEN** drei Alarme anstehen und eine Meldung eingeht
- **THEN** bleibt die Zone bei drei Alarmen, und die Meldung erscheint im Eingangsband

#### Scenario: Gelesen aus der aufgeklappten Zone
- **WHEN** die Zone aufgeklappt drei Alarme zeigt und Person A an einem davon „Gelesen“ wählt
- **THEN** ist nur dieser quittiert, und die übrigen zwei stehen weiter gebündelt

### Requirement: Quittieren gilt für alle Verbindungen des Nutzers

Öffnet ein Nutzer einen Eintrag einer Benachrichtigung oder markiert ihn als gelesen, SHALL sie
für ihn quittiert sein, und ihre Einträge und OS-Meldungen MUST auf all seinen offenen
Verbindungen verschwinden. Ausblenden quittiert nicht („Ausblenden quittiert nicht“).

#### Scenario: Zwei Tabs
- **WHEN** Person A den Einsatz in zwei Tabs offen hat und am Alarm „Auftrag überfällig“ im ersten „Gelesen“ wählt
- **THEN** verschwindet der Alarm auch im zweiten Tab

#### Scenario: Ausblenden in einem Tab
- **WHEN** Person A denselben Alarm im ersten Tab nur mit ✕ ausblendet
- **THEN** steht er im zweiten Tab weiter

### Requirement: Verpasste Benachrichtigungen werden nachgereicht

Gleicht ein Tab nach einem Verbindungsverlust voll ab oder öffnet ein Nutzer einen Einsatz, SHALL
das Frontend die unquittierten Benachrichtigungen des Nutzers aus den letzten 12 Stunden zeigen, die
der Tab nicht schon zeigt und die in diesem Tab nicht ausgeblendet sind, jeweils mit ihrer Uhrzeit.
Nachgereichte Benachrichtigungen MUST höchstens einen dezenten Ton auslösen, keinen Alarmton.

#### Scenario: Server-Neustart
- **WHEN** der Server neu startet, währenddessen ein Auftrag an Person A überfällig wird und A's Tab danach `lagged` erhält
- **THEN** zeigt A's Tab den Alarm „Auftrag überfällig“ mit der Uhrzeit in der Alarmzone und spielt einmal den dezenten Ton

#### Scenario: Ausgeblendet und nachgereicht
- **WHEN** Person A einen Alarm ausgeblendet hat und ihr Tab danach `lagged` erhält
- **THEN** erscheint der Alarm nicht wieder
