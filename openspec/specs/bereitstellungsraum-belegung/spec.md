# bereitstellungsraum-belegung Specification

## Purpose
Ein Bereitstellungsraum zeigt, wer wie lange wartet: je Kraft im Raum den Zeitpunkt, seit dem
sie dort steht, zu jeder Einheit ihre Fahrzeuge, je Raum die Kennzahlen der Belegung (Einheiten,
Fahrzeuge einschließlich der Fahrzeuge der Einheiten, längste Wartezeit) und die vollständige
Reihe seiner Belegungsereignisse. Liste und Detail lesen dieselben Kennzahlen, das gekoppelte
Gerät des Raums liest den Verlauf des eigenen Raums mit. Am Raum bucht die Führung oder das Gerät
des Raums das Eintreffen einer Kraft, auch einer unangemeldeten, die das System als Einheit mit
Meldung an die Einsatzleitung anlegt; die Führung übernimmt oder weist sie ab. Die Führung ruft
eine Kraft aus dem Raum ab, wahlweise mit Ziel-Abschnitt und Auftrag in einer Transaktion mit
genau einem ETB-Eintrag; eine Einheit nimmt ihre Untereinheiten mit. Die abgerufene Kraft bleibt
im Raum, bis ihr Ausrücken als Austritt gebucht ist; ein Abruf lässt sich zurücknehmen. Die
Detailseite bietet „Abrufen“ als Hauptaktion je bereitgestellter Kraft und zeigt abgerufene Kräfte
getrennt oben unter „Abgerufen“; das Gerät des Raums bucht dort das Ausrücken.
Detailseite, Liste und Druck zeigen die Kennzahlen mit laufender Wartezeit, die Belegung am längsten
wartend zuerst und den Verlauf in einem Aufklappbereich, der erst beim Aufklappen lädt.

## Requirements

### Requirement: Wartezeit je Kraft im Raum
Das Detail eines Bereitstellungsraums SHALL für jede Einheit und jedes einheitenlose Fahrzeug,
das im Raum steht, den Zeitpunkt nennen, seit dem es dort steht („seit“). „Seit“ MUST der
Zeitpunkt des jüngsten Eintritts, Wechsels oder Austritts des Objekts sein, gemessen an der
Erfassungsreihenfolge; Abrufe und ihre Rücknahmen MUST dabei übergangen werden. „Seit“ MUST nur
dann gesetzt sein, wenn dieses Ereignis ein Eintritt oder ein Wechsel in genau diesen Raum ist;
sonst MUST „seit“ fehlen. Ein früherer Eintritt in einen anderen Raum MUST „seit“ nicht
bestimmen. Zeitpunkte MUST als UTC ohne Zonenkennung (`YYYY-MM-DD HH:MM:SS`) übertragen werden.

#### Scenario: Eintritt
- **WHEN** die Einheit „1. Zug“ um 13:42 in den BR Sportplatz eintritt
- **THEN** nennt das Detail des BR Sportplatz für „1. Zug“ „seit“ 13:42

#### Scenario: Wechsel zwischen zwei Räumen
- **WHEN** „1. Zug“ um 13:42 in den BR Sportplatz eintritt und um 14:10 in den BR Schule wechselt
- **THEN** nennt das Detail des BR Schule für „1. Zug“ „seit“ 14:10, nicht 13:42
- **AND** das Detail des BR Sportplatz führt „1. Zug“ nicht mehr

#### Scenario: Belegung ohne Ereignis
- **WHEN** eine Einheit im Raum steht, für die kein Eintritt oder Wechsel in diesen Raum als
  jüngstes Ereignis vorliegt
- **THEN** führt das Detail die Einheit ohne „seit“

#### Scenario: Abruf ändert die Wartezeit nicht
- **WHEN** „1. Zug“ um 13:42 in den BR Sportplatz eintritt, um 14:30 abgerufen wird und der
  Abruf um 14:35 zurückgenommen wird
- **THEN** nennt das Detail für „1. Zug“ „seit“ 13:42

### Requirement: Fahrzeuge der Einheiten im Raum
Das Detail eines Bereitstellungsraums SHALL zu jeder Einheit im Raum ihre aktiven Fahrzeuge mit
Kennung und Funkrufnamen nennen. Fahrzeuge, die entlassen oder storniert sind, MUST fehlen. Die
Fahrzeuge einer Untereinheit MUST nur dann erscheinen, wenn die Untereinheit selbst im Raum
steht. Die einheitenlosen Fahrzeuge im Raum MUST weiter getrennt davon stehen.

#### Scenario: Einheit mit Fahrzeug
- **WHEN** die Einheit „1. Zug“ mit dem Fahrzeug „Florian 1/44-1“ im BR Sportplatz steht
- **THEN** nennt das Detail bei „1. Zug“ das Fahrzeug „Florian 1/44-1“

#### Scenario: Untereinheit außerhalb des Raums
- **WHEN** „1. Zug“ im BR Sportplatz steht und seine Untereinheit „Gruppe 2“ mit eigenem Fahrzeug
  in keinem Raum steht
- **THEN** nennt das Detail das Fahrzeug der „Gruppe 2“ nicht

### Requirement: Kennzahlen der Belegung
Das System SHALL je Bereitstellungsraum drei Kennzahlen der Belegung liefern: die Zahl der
Einheiten im Raum (Untereinheiten, die selbst im Raum stehen, einzeln gezählt), die Zahl der
Fahrzeuge im Raum und den frühesten „seit“-Zeitpunkt der Kräfte im Raum („längste Wartezeit“).
Die Fahrzeugzahl MUST die einheitenlosen Fahrzeuge im Raum und die aktiven Fahrzeuge der
Einheiten im Raum umfassen und MUST jedes Fahrzeug genau einmal zählen. Kräfte ohne „seit“ MUST
den frühesten Zeitpunkt nicht bestimmen; hat keine Kraft ein „seit“, MUST er fehlen. Liste und
Detail MUST dieselben Kennzahlen aus derselben Berechnung liefern.

#### Scenario: Fahrzeuge der Einheiten zählen mit
- **WHEN** im BR Sportplatz zwei Einheiten mit je einem Fahrzeug und ein Fahrzeug ohne Einheit
  stehen
- **THEN** ist die Fahrzeugzahl des Raums 3 und die Zahl der Einheiten 2

#### Scenario: Ein Fahrzeug doppelt geführt
- **WHEN** ein Fahrzeug als einheitenloses Fahrzeug im Raum geführt wird und zugleich einer
  Einheit im Raum angehört
- **THEN** zählt es in der Fahrzeugzahl einmal

#### Scenario: Längste Wartezeit
- **WHEN** im Raum eine Einheit seit 13:42 und ein Fahrzeug seit 14:05 stehen
- **THEN** ist der früheste „seit“-Zeitpunkt des Raums 13:42

#### Scenario: Liste gleich Detail
- **WHEN** die Liste der Bereitstellungsräume und das Detail des BR Sportplatz abgerufen werden
- **THEN** tragen beide für den BR Sportplatz dieselbe Zahl der Einheiten, dieselbe Fahrzeugzahl
  und denselben frühesten „seit“-Zeitpunkt

### Requirement: Liste der Räume mit Belegung
Die Liste der Bereitstellungsräume SHALL je Raum neben den Raumdaten den Namen seines Abschnitts,
die Kennzahlen der Belegung und die Kennungen der Einheiten im Raum tragen. Die Kennzahlen MUST
für alle Räume mit einer festen Zahl von Abfragen entstehen, unabhängig von der Zahl der Räume.
Ein gekoppeltes Gerät eines Bereitstellungsraums MUST weiter nur seinen eigenen Raum erhalten.

#### Scenario: Raum mit Abschnitt
- **WHEN** der BR Sportplatz dem Abschnitt „Nord“ zugeordnet ist und zwei Einheiten trägt
- **THEN** nennt die Liste beim BR Sportplatz „Nord“, die Kennungen beider Einheiten und ihre
  Kennzahlen

### Requirement: Verlauf eines Raums lesen
Das System SHALL je Bereitstellungsraum die vollständige Reihe seiner Belegungsereignisse liefern,
ungeblättert, neueste zuerst nach Erfassungsreihenfolge. Die Reihe MUST Eintritte, Wechsel in den
Raum, Wechsel aus dem Raum in einen anderen Raum, Abrufe, Rücknahmen von Abrufen und Austritte
enthalten, auch Austritte durch Auflösen einer Einheit oder Entlassen eines Fahrzeugs. Jeder
Eintrag MUST Zeitpunkt, Art, Objekttyp, Objektkennung, Objektname und, falls erfasst, die Notiz
tragen; ein Wechsel in den Raum MUST den Herkunftsraum, ein Wechsel aus dem Raum den Zielraum
nennen. Ein Abruf MUST sein Ziel und, falls vorhanden, die Auftragsnummer nennen, der Abruf
einer mitgenommenen Untereinheit die Einheit, mit der sie abgerufen wurde; ein Austritt, dem ein
Abruf vorausging, MUST dessen Ziel nennen. Ein Objekt, das inzwischen aufgelöst oder
entlassen ist, MUST mit seinem Namen erscheinen. Auch ein stornierter oder aufgelöster Raum MUST
seine Reihe liefern. Ein Raum eines anderen Einsatzes oder ein unbekannter Raum MUST mit 404
antworten.

#### Scenario: Reihe mit Wechsel und Austritt
- **WHEN** „1. Zug“ in den BR Sportplatz eintritt, danach in den BR Schule wechselt und dort
  austritt
- **THEN** zeigt die Reihe des BR Sportplatz „Wechsel nach BR Schule“ vor „Eintritt“
- **AND** die Reihe des BR Schule zeigt „Austritt“ vor „Wechsel von BR Sportplatz“

#### Scenario: Austritt durch Auflösen
- **WHEN** eine Einheit, die im BR Sportplatz steht, aufgelöst wird
- **THEN** zeigt die Reihe des BR Sportplatz einen Austritt dieser Einheit mit der Notiz
  „Einheit aufgelöst“

#### Scenario: Abruf und Ausrücken
- **WHEN** „HLF 20“ aus dem BR Sportplatz nach „EA Deich“ mit Auftrag Nr. 7 abgerufen wird und
  danach ausrückt
- **THEN** zeigt die Reihe des BR Sportplatz „Austritt“ mit Ziel „EA Deich“ vor „Abruf“ mit Ziel
  „EA Deich“ und Auftrag Nr. 7

#### Scenario: Raum ohne Belegung
- **WHEN** die Reihe eines Raums ohne Belegungsereignis abgerufen wird
- **THEN** ist die Reihe leer

#### Scenario: Raum eines anderen Einsatzes
- **WHEN** die Reihe mit der Kennung eines Raums abgerufen wird, der zu einem anderen Einsatz
  gehört
- **THEN** antwortet das System mit 404

### Requirement: Rechte am Verlauf
Der Verlauf MUST dieselben Rechte verlangen wie das Detail eines Bereitstellungsraums:
Lesezugriff auf den Einsatz und das Modul Bereitstellungsräume. Ein Beobachter MUST den Verlauf
lesen können. Ist das Modul für den Einsatz ausgeblendet, MUST ein Nicht-Admin 403 erhalten.

#### Scenario: Beobachter liest den Verlauf
- **WHEN** ein Benutzer ohne Schreibrecht den Verlauf eines Raums abruft
- **THEN** liefert das System die Reihe

#### Scenario: Modul ausgeblendet
- **WHEN** das Modul Bereitstellungsräume für den Einsatz ausgeblendet ist und ein Nicht-Admin den
  Verlauf abruft
- **THEN** antwortet das System mit 403

### Requirement: Belegung bleibt live aktuell
Ändert sich, was das Detail eines Bereitstellungsraums über seine Kräfte trägt, SHALL das System
für diesen Raum das Live-Ereignis `bereitstellungsraum` senden. Das MUST gelten für Belegen,
Auflösen und Entlassen wie bisher und zusätzlich, wenn ein Fahrzeug einer Einheit im Raum
zugeordnet, von ihr freigegeben, aus dem Einsatz entlassen oder umbenannt wird, wenn ein Fahrzeug
von einer Einheit im Raum zu einer anderen umgehängt wird (beide Räume), wenn beim Bilden einer
Einheit aus einer Vorlage ein Fahrzeug aus einer Einheit im Raum umgehängt wird und wenn eine
Einheit im Raum umbenannt wird. Ohne Änderung MUST kein Ereignis entstehen.

#### Scenario: Fahrzeug kommt zur Einheit im Raum
- **WHEN** einer Einheit im BR Sportplatz ein Fahrzeug zugeordnet wird
- **THEN** erhalten die Leser des BR Sportplatz das Ereignis `bereitstellungsraum`, auch ohne
  Recht auf Einheiten oder Fahrzeuge

#### Scenario: Einheit in keinem Raum
- **WHEN** einer Einheit, die in keinem Raum steht, ein Fahrzeug zugeordnet wird
- **THEN** entsteht kein Ereignis `bereitstellungsraum`

#### Scenario: Einheit im Raum umbenannt
- **WHEN** die Einheit „1. Zug“ im BR Sportplatz in „1. Zug Nord“ umbenannt wird
- **THEN** erhalten die Leser des BR Sportplatz das Ereignis `bereitstellungsraum`

### Requirement: Kennzahlen auf der Detailseite
Die Detailseite eines Bereitstellungsraums SHALL die Kennzahlen „Bereitgestellt“ (Stärke),
„Fahrzeuge“, „Einheiten“ und „Längste Wartezeit“ zeigen. „Fahrzeuge“, „Einheiten“ und „Längste
Wartezeit“ MUST aus den Kennzahlen des Servers kommen, nicht aus der Länge der angezeigten
Listen. Die Stärke MUST nur zählen, wer im Raum steht: die eigene Ist-Stärke jeder Einheit im
Raum, ohne Untereinheiten, die anderswo stehen (wie „Fahrzeuge“); fehlt eine Einheit des Raums in
der Einheitenliste, MUST statt einer Zahl „—“ mit Grund stehen. Ohne
frühesten „seit“-Zeitpunkt MUST „Längste Wartezeit“ „—“ zeigen. Die Zahl der Belegungen, die vor
dem Auflösen genannt wird („noch n belegt“), MUST weiter nur Einheiten und einheitenlose
Fahrzeuge zählen, wie die Sperre des Servers beim Auflösen.

#### Scenario: Fahrzeuge 3
- **WHEN** im Raum zwei Einheiten mit je einem Fahrzeug und ein Fahrzeug ohne Einheit stehen
- **THEN** zeigt die Kennzahl „Fahrzeuge“ 3 und „Einheiten“ 2
- **AND** nennt die Seite vor dem Auflösen „noch 3 belegt“

#### Scenario: Gruppe in einem anderen Raum
- **WHEN** der „1. Zug“ (Zugtrupp 1/1/2) mit „Gruppe 1“ (0/1/8) im BR Sportplatz steht und
  „Gruppe 2“ (0/1/8) im BR Schule
- **THEN** zeigt der BR Sportplatz „Bereitgestellt“ 1/2/10//13 und der BR Schule 0/1/8//9

### Requirement: Zeile je Kraft mit Wartezeit
Die Detailseite SHALL je Einheit im Raum Name, Typ, Stärke, die Funkrufnamen ihrer Fahrzeuge und
„seit <Uhrzeit> · <Dauer>“ zeigen, je einheitenlosem Fahrzeug Funkrufnamen, Typ und „seit …“.
Die Stärke der Zeile MUST die Einheit samt ihren Untereinheiten im selben Raum nennen;
Untereinheiten, die anderswo stehen, MUST NOT zählen. Die Dauer MUST ohne neuen Abruf mit der
Uhr weiterlaufen (höchstens eine Minute Versatz) und MUST nie negativ sein. Ohne „seit“ MUST die Zeile keine Zeitangabe tragen.

#### Scenario: Wartezeit läuft
- **WHEN** eine Einheit seit 13:42 im Raum steht und die Seite um 14:30 offen ist
- **THEN** zeigt ihre Zeile „seit 1342 · 48 min“
- **AND** um 14:31 zeigt sie ohne neuen Abruf „49 min“

### Requirement: Folge nach Wartezeit
Die Detailseite SHALL die Einheiten und die einheitenlosen Fahrzeuge jeweils so ordnen, dass die
am längsten wartende Kraft zuerst steht; Kräfte ohne „seit“ MUST am Ende stehen, gleiche
Zeitpunkte nach Name. Eine neu eingetretene Kraft MUST damit ans Ende kommen. Die Schleuse für
Zugänge anderer Arbeitsplätze, solange Zeiger oder Fokus in der Belegung stehen, MUST
unverändert gelten.

#### Scenario: Neue Kraft
- **WHEN** zwei Einheiten seit 13:42 und 14:05 im Raum stehen und eine dritte eintritt
- **THEN** steht die Einheit seit 13:42 oben und die neue Einheit unten

### Requirement: Verlauf auf der Detailseite
Die Detailseite SHALL einen beschrifteten Aufklappbereich „Verlauf“ unterhalb der Belegung
anbieten, der seinen Zustand zugänglich meldet und ohne Schreibrecht und am Gerät verfügbar ist.
Die Reihe MUST erst beim Aufklappen geladen werden. Jeder Eintrag MUST taktische Uhrzeit, Art als
Wort, Objekt und gegebenenfalls Herkunft, Ziel und Notiz zeigen. Laden, Fehler und leere Reihe
MUST in Worten erscheinen; ein Ladefehler MUST NOT als leere Reihe erscheinen. Bei geöffnetem
Verlauf MUST ein neues Ereignis ohne Neuladen der Seite erscheinen. Der Druck MUST den Verlauf
nicht aufklappen.

#### Scenario: Aufklappen lädt
- **WHEN** der Verlauf aufgeklappt wird
- **THEN** wird die Reihe abgerufen und angezeigt
- **AND** vor dem Aufklappen wurde sie nicht abgerufen

#### Scenario: Ladefehler
- **WHEN** der Abruf der Reihe scheitert
- **THEN** nennt der Bereich den Fehler und nicht „Noch keine Belegung“

### Requirement: Liste zeigt die Belegung
Die Liste der Bereitstellungsräume SHALL je Raum neben Bezeichnung, Status und Standort die
Spalten Abschnitt, Stärke, Fahrzeuge, Einheiten und Längste Wartezeit zeigen. Die Werte MUST
denen der Detailseite desselben Raums gleichen; die Stärke MUST über dieselbe Rechnung und
Formatierung wie die Detailseite entstehen. Ist die Einheitenliste nicht verfügbar oder fehlt
eine Einheit des Raums darin, MUST „Stärke“ „—“ mit dem sichtbaren Grund „unvollständig“ zeigen,
nicht nur als Tooltip; ein leerer Raum zeigt nur „—“.

#### Scenario: Liste und Detail
- **WHEN** der BR Sportplatz zwei Einheiten (0/1/5//6 zusammen) mit je einem Fahrzeug und ein
  Fahrzeug ohne Einheit trägt
- **THEN** zeigt seine Zeile in der Liste Stärke 0/1/5//6, Fahrzeuge 3 und Einheiten 2, wie die
  Detailseite

### Requirement: Druck mit Wartezeiten
Der Druck der Detailseite SHALL alle Kräfte des Raums ohne Zurückhalten durch die Schleuse zeigen,
jede mit „seit“ und Dauer zum Druckzeitpunkt, dazu die Kennzahl „Längste Wartezeit“.

#### Scenario: Drucken bei gehaltener Liste
- **WHEN** ein Zugang hinter dem Sammelbanner wartet und die Seite gedruckt wird
- **THEN** enthält der Druck auch diesen Zugang mit seiner Wartezeit

### Requirement: Eintreffen einer bekannten Kraft buchen
Das System SHALL eine Einheit oder ein einheitenloses Fahrzeug des Einsatzes über
`POST /api/einsaetze/{id}/bereitstellungsraeume/{bid}/eintreffen` in einen Bereitstellungsraum
einbuchen. In einer Transaktion MUST dabei der Eintritt in den Raum entstehen, bei einer Einheit
das Ereignis `eintreffen` in der Kräfte-Zeitachse mit Quelle `bereitstellungsraum` und genau ein
ETB-Eintrag. Trägt die offene Periode der Einheit schon ein Eintreffen, MUST das Ereignis
ausgelassen werden und die Buchung trotzdem gelingen. Ein Fahrzeug MUST kein Zeitachsen-Ereignis
erhalten. Eine Kraft, die schon in einem Bereitstellungsraum steht, aufgelöst oder entlassen ist,
oder ein Fahrzeug einer Einheit MUST mit 409 abgelehnt werden; nichts wird geschrieben. Eine
Kraft eines anderen Einsatzes MUST mit 404 abgelehnt werden. Nennt die Anfrage weder eine
bekannte noch eine unangemeldete Kraft, MUST das System mit 400 antworten, nennt sie beides, mit
422.

#### Scenario: Erwartete Einheit trifft ein
- **WHEN** die Einheit „HLF 20 FF Musterstadt“ ohne Eintreffen um 1430 am BR Sportplatz gebucht wird
- **THEN** steht sie im BR Sportplatz, ihre Zeitachse trägt ein Eintreffen 1430 mit Quelle `bereitstellungsraum`, und das ETB erhält genau einen Eintrag „HLF 20 FF Musterstadt im BR Sportplatz eingetroffen“

#### Scenario: Schon eingetroffen
- **WHEN** eine Einheit, deren offene Periode ein Eintreffen um 1400 trägt, um 1430 am BR gebucht wird
- **THEN** steht sie im BR, ihre Zeitachse trägt weiter genau ein Eintreffen (1400), und das ETB nennt den Eintritt in den Bereitstellungsraum

#### Scenario: Schon in einem Raum
- **WHEN** eine Einheit, die im BR Schule steht, am BR Sportplatz gebucht wird
- **THEN** antwortet das System mit 409, und weder Belegung noch Zeitachse noch ETB ändern sich

#### Scenario: Kraft eines anderen Einsatzes
- **WHEN** die Anfrage eine Einheit nennt, die zu einem anderen Einsatz gehört
- **THEN** antwortet das System mit 404, und nichts ist geschrieben

### Requirement: Unangemeldete Kraft erfassen
Das System SHALL über dieselbe Route eine Kraft erfassen, die im Einsatz noch nicht geführt wird:
Funkrufname (Pflicht), Organisation, Fahrzeugtyp, gemeldete Stärke F/UF/M und Bemerkung (je
optional) sowie bis zu `SAMMEL_MAX` Fahrzeuge. In einer Transaktion MUST genau eine neue Einheit
mit diesen Fahrzeugen als Ad-hoc-Fahrzeugen, der Eintritt der Einheit in den Raum, ihr Eintreffen
in der Zeitachse, eine Meldung an die Einsatzleitung und genau ein ETB-Eintrag entstehen.
Scheitert ein Schritt, MUST nichts davon bestehen bleiben. Ein fehlender oder leerer Funkrufname,
mehr als `SAMMEL_MAX` Fahrzeuge, Funkrufname, Organisation oder Fahrzeugtyp über 200 Zeichen,
eine Bemerkung über 2 000 Zeichen oder eine unvollständige oder negative Stärke MUST mit 400
abgelehnt werden. Die gemeldete Stärke MUST
nur im Text von Meldung und ETB stehen und MUST NOT die Soll-Stärke der Einheit setzen. Die
Bemerkung MUST an der Einheit stehen und MUST NOT in Meldung oder ETB stehen.

#### Scenario: Unangemeldetes Fahrzeug
- **WHEN** der Einweiser am BR Sportplatz „FL-MUS 1-44-1“, Organisation „FF Musterstadt“, Typ „HLF 20“, Stärke 1/1/7 unangemeldet bucht
- **THEN** gibt es genau eine neue Einheit „FL-MUS 1-44-1“ mit genau einem Fahrzeug, einen Belegungseintrag, ein Eintreffen, eine Meldung an die Einsatzleitung und einen ETB-Eintrag, der „unangemeldet“ und die Stärke 1/1/7 nennt

#### Scenario: Fehler mitten in der Erfassung
- **WHEN** das Schreiben des Belegungseintrags nach dem Anlegen der Einheit scheitert
- **THEN** antwortet das System mit einem Fehler, und es gibt keine neue Einheit, kein Fahrzeug, keine Meldung, kein Ereignis und keinen ETB-Eintrag

#### Scenario: Verband mit zwei Fahrzeugen
- **WHEN** eine unangemeldete Kraft mit den Fahrzeugen „FL-MUS 1-44-1“ und „FL-MUS 1-19-1“ gebucht wird
- **THEN** gehören beide Fahrzeuge der neuen Einheit an, und nur die Einheit trägt einen Belegungseintrag

#### Scenario: Stärke nicht als Soll
- **WHEN** eine unangemeldete Kraft mit Stärke 1/1/7 gebucht wird
- **THEN** hat die neue Einheit keine Soll-Stärke

#### Scenario: Funkrufname zu lang
- **WHEN** eine unangemeldete Kraft mit einem Funkrufnamen von 201 Zeichen gebucht wird
- **THEN** antwortet das System mit 400, und nichts ist angelegt

### Requirement: Meldung an die Einsatzleitung bei unangemeldeter Kraft
Die Meldung einer unangemeldeten Kraft SHALL die neue Einheit als strukturierten Absender tragen,
ohne Abschnitt, die Empfängerfunktion Einsatzleitung, Bestätigungspflicht, Priorität normal und
nicht die Meldungsart Sofortmeldung. Ihr Inhalt MUST Funkrufname, Organisation, Fahrzeugtyp,
Stärke, den Raum und dessen Abschnitt nennen, soweit bekannt. Die Benachrichtigung „Neue
Meldung“ an die Einsatzleitung MUST nach dem Commit genau einmal entstehen, auch wenn dieselbe
Erfassung erneut gesendet wird. Genau ein ETB-Eintrag MUST entstehen: bei aktivem Auto-ETB der
Eintrag der Meldung, sonst ein System-Eintrag mit ihrem Inhalt.

#### Scenario: Einsatzleitung erfährt es
- **WHEN** am BR Sportplatz im Abschnitt Nord eine unangemeldete Kraft gebucht wird
- **THEN** erhalten die Nutzer der Funktion Einsatzleitung einen Hinweis „Neue Meldung“, und die Meldung nennt BR Sportplatz und Abschnitt Nord

#### Scenario: Ein Eintrag im Tagebuch
- **WHEN** bei aktivem Auto-ETB eine unangemeldete Kraft gebucht wird
- **THEN** trägt das ETB genau einen neuen Eintrag, den der Meldung

### Requirement: Doppelbuchung erkennen
Trägt eine aktive Einheit oder ein aktives Fahrzeug des Einsatzes denselben Funkrufnamen wie die
unangemeldete Kraft (ohne Unterschied von Groß- und Kleinschreibung und Leerzeichen), MUST das
System mit 422 und einem Grund ablehnen, der die vorhandene Kraft nennt, und nichts schreiben.
Bestätigt die Anfrage die Neuanlage ausdrücklich, MUST die Kraft trotzdem angelegt werden.

#### Scenario: Schon im Einsatz
- **WHEN** „FL-MUS 1-44-1“ als Fahrzeug im Einsatz geführt wird und am BR als unangemeldet „fl-mus 1-44-1“ gebucht wird
- **THEN** antwortet das System mit 422 und nennt „FL-MUS 1-44-1“, und nichts ist angelegt

#### Scenario: Trotzdem neu anlegen
- **WHEN** dieselbe Erfassung mit ausdrücklicher Bestätigung gesendet wird
- **THEN** ist die Kraft angelegt

### Requirement: Eintreffen nur am aktiven Raum und mit Rechten
Ein Eintreffen MUST Schreibrecht am Modul Bereitstellungsräume verlangen; eine unangemeldete Kraft
MUST zusätzlich das Recht an den Modulen Einheiten und Fahrzeuge verlangen und sonst mit 403
abgelehnt werden, bevor etwas geschrieben wird. Ein Raum, der nicht `aktiv` oder storniert ist,
MUST mit 422 ablehnen. Ein Recht an Meldungen oder an der Zeitachse MUST NOT nötig sein.

#### Scenario: Raum geplant
- **WHEN** eine Kraft an einem BR mit Status `geplant` gebucht wird
- **THEN** antwortet das System mit 422, und nichts ist geschrieben

#### Scenario: Einheiten gesperrt
- **WHEN** eine Person mit BR-Schreibrecht, aber ohne Recht am Modul Einheiten eine unangemeldete Kraft bucht
- **THEN** antwortet das System mit 403, und nichts ist angelegt

### Requirement: Eintreffen ist idempotent
Eine Erfassung mit `client_id` SHALL je Einsatz höchstens einmal wirken. Ein erneutes Senden mit
derselben `client_id` MUST das gespeicherte Ergebnis liefern und nichts erneut anlegen,
auch wenn der Raum oder der Einsatz inzwischen nicht mehr aktiv ist; eine neue Erfassung an
einem abgeschlossenen Einsatz MUST mit 409 abgelehnt werden. Dieselbe `client_id` für einen
anderen Raum MUST mit 422 abgelehnt werden; ein Gerät, das die `client_id` einer fremden
Erfassung sendet, MUST 409 erhalten. Ein mitgesendeter Erfassungszeitpunkt MUST für Belegung,
Zeitachse und Meldung gelten; liegt er mehr als 60 Sekunden in der Zukunft, MUST das System mit
400 antworten.

#### Scenario: Replay nach Netzausfall
- **WHEN** eine unangemeldete Kraft mit `client_id` „a1“ gebucht und dieselbe Anfrage danach erneut gesendet wird
- **THEN** antworten beide mit derselben Einheit, und es gibt genau eine Einheit, ein Fahrzeug, einen Belegungseintrag, eine Meldung und eine Benachrichtigung

#### Scenario: Erfassung von vorhin
- **WHEN** eine um 1412 vorgemerkte Erfassung um 1430 gesendet wird
- **THEN** tragen Belegung und Eintreffen den Zeitpunkt 1412

#### Scenario: Replay nach Einsatzabschluss
- **WHEN** eine schon gebuchte Erfassung nach dem Abschluss des Einsatzes erneut gesendet wird
- **THEN** liefert das System das gespeicherte Ergebnis, und eine neue Erfassung dort erhält 409

### Requirement: Kennzeichen „nicht übernommen“ und Herkunft
Eine unangemeldet erfasste Einheit SHALL bis zu ihrer Übernahme als „nicht übernommen“ gelten.
Einheiten-Antwort und Belegung des Raums MUST das als `nicht_uebernommen_seit` liefern und die
Herkunft als `unangemeldet` dauerhaft, auch nach der Übernahme. Nach Übernahme oder Abweisen MUST
`nicht_uebernommen_seit` fehlen.

#### Scenario: Kennzeichen geliefert
- **WHEN** die Führung nach einer unangemeldeten Buchung die Einheitenliste abruft
- **THEN** trägt die neue Einheit `nicht_uebernommen_seit` mit dem Erfassungszeitpunkt und `unangemeldet`

#### Scenario: Herkunft bleibt
- **WHEN** die Einheit übernommen wurde und weiter im BR steht
- **THEN** liefert ihre Belegungszeile `unangemeldet` und kein `nicht_uebernommen_seit` mehr

### Requirement: Unangemeldete Einheit übernehmen
Die Führung SHALL eine nicht übernommene Einheit über
`POST /api/einsaetze/{id}/einheiten/{eid}/uebernehmen` übernehmen können, optional mit Abschnitt
und Über-Einheit nach den Regeln der Einheiten-Änderung. Die Übernahme MUST das Kennzeichen
aufheben, die Meldung des Eintreffens bestätigen und genau einen ETB-Eintrag schreiben, der die
gewählte Unterstellung nennt, und MUST NOT die Einheit aus dem Bereitstellungsraum nehmen. Sie
MUST das Recht am Modul Einheiten verlangen. Eine Einheit ohne offene Übernahme MUST mit 422,
eine aufgelöste mit 409 abgelehnt werden.

#### Scenario: Übernehmen mit Abschnitt
- **WHEN** die Einsatzleitung „FL-MUS 1-44-1“ mit Abschnitt Nord übernimmt
- **THEN** trägt die Einheit kein Kennzeichen mehr, gehört dem Abschnitt Nord an, steht weiter im BR, die Meldung ist bestätigt, und das ETB nennt „Einheit «FL-MUS 1-44-1» übernommen, Abschnitt Nord“

#### Scenario: Zweimal übernommen
- **WHEN** eine schon übernommene Einheit erneut übernommen werden soll
- **THEN** antwortet das System mit 422

### Requirement: Unangemeldete Einheit abweisen
Die Führung SHALL eine nicht übernommene Einheit über
`POST /api/einsaetze/{id}/einheiten/{eid}/abweisen` abweisen können. In einer Transaktion MUST
die Einheit aufgelöst werden (Austritt aus dem Raum, Entlassung in der Zeitachse), jedes ihrer
Fahrzeuge entlassen, die Meldung des Eintreffens bestätigt und genau ein ETB-Eintrag geschrieben
werden. Abweisen MUST die Rechte an den Modulen Einheiten und Fahrzeuge verlangen; eine
aufgelöste Einheit MUST mit 409, eine Einheit ohne offene Übernahme mit 422 abgelehnt werden.

#### Scenario: Abweisen
- **WHEN** die Einsatzleitung „FL-MUS 1-44-1“ abweist
- **THEN** verzeichnet der BR ihren Austritt, die Einheit ist aufgelöst, ihre Zeitachse trägt die Entlassung, ihr Fahrzeug ist entlassen, die Meldung ist bestätigt, und das ETB trägt genau einen Eintrag „Einheit «FL-MUS 1-44-1» abgewiesen …“

### Requirement: Kraft aus dem Raum abrufen
Das System SHALL über `POST /api/einsaetze/{id}/bereitstellungsraeume/{bid}/abruf` eine Einheit
oder ein einheitenloses Fahrzeug, das im Raum `{bid}` steht, abrufen. Der Abruf MUST ein
Belegungsereignis der Art `abruf` mit dem Zeitpunkt der Serveruhr schreiben und die Kraft im
Raum lassen. Ziel-Abschnitt und Auftragstext MUST optional sein.

#### Scenario: Abruf ohne Ziel
- **WHEN** die Führung das „HLF 20“ aus dem BR Sportplatz ohne Abschnitt und ohne Auftrag abruft
- **THEN** steht das „HLF 20“ weiter im BR Sportplatz und gilt dort als abgerufen
- **AND** seine Unterstellung ist unverändert

### Requirement: Vorbedingungen des Abrufs
Der Raum MUST aktiv und nicht storniert sein, sonst 422. Die Kraft MUST im Raum `{bid}` stehen
und MUST NOT schon abgerufen sein, sonst 422. Ein Fahrzeug, das einer Einheit angehört, MUST mit
422 abgelehnt werden; es geht mit seiner Einheit. Ein unbekannter Objekttyp MUST mit 400, eine
aufgelöste Einheit oder ein entlassenes Fahrzeug mit 409, eine Kraft eines anderen Einsatzes oder
eine unbekannte Kraft mit 404 abgelehnt werden. Bei jeder Ablehnung MUST nichts geschrieben sein.

#### Scenario: Kraft in einem anderen Raum
- **WHEN** die Führung über den BR Sportplatz eine Einheit abruft, die im BR Schule steht
- **THEN** antwortet das System mit 422, und nichts ist geschrieben

#### Scenario: Zweiter Abruf
- **WHEN** eine schon abgerufene Einheit noch einmal abgerufen wird
- **THEN** antwortet das System mit 422, und es entsteht kein zweites Abruf-Ereignis

#### Scenario: Fahrzeug einer Einheit
- **WHEN** die Führung das Fahrzeug „Florian 1/44-1“ abruft, das zur Einheit „1. Zug“ im BR
  Sportplatz gehört
- **THEN** antwortet das System mit 422, und nichts ist geschrieben

### Requirement: Abruf setzt die Unterstellung
Ist ein Ziel-Abschnitt gewählt, SHALL der Abruf die abgerufene Einheit diesem Abschnitt
unterstellen. Ohne Abschnitt MUST die Unterstellung unverändert bleiben. Ein Abschnitt eines
anderen Einsatzes oder ein unbekannter Abschnitt MUST mit 404 abgelehnt werden, wie beim Anlegen
eines Raums. Ein einheitenloses Fahrzeug hat keine Unterstellung; ein Abruf mit Abschnitt MUST
dafür mit 422 abgelehnt werden.

#### Scenario: Abruf mit Abschnitt
- **WHEN** die Führung „HLF 20“ aus dem BR Sportplatz mit dem Abschnitt „EA Deich“ abruft
- **THEN** ist „HLF 20“ dem Abschnitt „EA Deich“ unterstellt

#### Scenario: Fahrzeug ohne Einheit mit Abschnitt
- **WHEN** die Führung ein einheitenloses Fahrzeug mit Abschnitt abruft
- **THEN** antwortet das System mit 422, und nichts ist geschrieben

#### Scenario: Abschnitt eines anderen Einsatzes
- **WHEN** die Führung „HLF 20“ mit einem Abschnitt eines anderen Einsatzes abruft
- **THEN** antwortet das System mit 404, und nichts ist geschrieben

### Requirement: Ziel bleibt im Nachweis
Das Abruf-Ereignis MUST den Ziel-Abschnitt und dessen Namen zum Zeitpunkt des Abrufs tragen.
Wird der Abschnitt später gelöscht, MUST der Bezug entfallen und der Name im Ereignis erhalten
bleiben.

#### Scenario: Abschnitt später gelöscht
- **WHEN** „HLF 20“ nach „EA Deich“ abgerufen wurde und der Abschnitt „EA Deich“ danach aufgelöst
  wird
- **THEN** nennt der Abruf im Verlauf weiter „EA Deich“ als Ziel

### Requirement: Abruf mit Auftrag
Ist ein Auftragstext angegeben, SHALL der Abruf einen Auftrag mit diesem Text an die abgerufene
Einheit bzw. das abgerufene Fahrzeug erteilen. Der Auftrag MUST dieselbe Prüfung und dieselben
Vorgaben durchlaufen wie ein direkt erfasster Auftrag, als Ziel den Namen des Ziel-Abschnitts
tragen, falls einer gewählt ist, und seine Anordnung nach der Auto-ETB-Regel des Einsatzes
selbst schreiben. Das Abruf-Ereignis MUST auf den Auftrag verweisen. Ein leerer Text MUST als
„kein Auftrag“ gelten. Ein Auftragstext über der Grenze des Auftragstexts MUST mit 400 abgelehnt
werden, ohne dass etwas geschrieben ist.

#### Scenario: Abruf mit Auftrag
- **WHEN** die Führung „HLF 20“ nach „EA Deich“ mit dem Auftrag „Sandsackverbau“ abruft
- **THEN** gibt es einen Auftrag „Sandsackverbau“ an „HLF 20“ mit dem Ziel „EA Deich“
- **AND** der Abruf nennt die Nummer dieses Auftrags

#### Scenario: Auftragstext zu lang
- **WHEN** die Führung „HLF 20“ mit einem Auftragstext über der Grenze abruft
- **THEN** antwortet das System mit 400, und es gibt weder Abruf noch Auftrag

### Requirement: Genau ein ETB-Eintrag zum Abruf
Der Abruf MUST genau einen System-Eintrag schreiben, der Kraft, Raum, gegebenenfalls Ziel und
Auftragsnummer nennt, etwa „HLF 20 aus Bereitstellungsraum Sportplatz abgerufen nach EA Deich
(Auftrag Nr. 7)“. Den Eintrag „Abschnitt zugeordnet“ des Einheitenwegs MUST der Abruf nicht
schreiben; den Auftragstext MUST der Abruf-Eintrag nicht wiederholen.

#### Scenario: Abruf mit Abschnitt im ETB
- **WHEN** „HLF 20“ aus dem BR Sportplatz nach „EA Deich“ ohne Auftrag abgerufen wird
- **THEN** steht im ETB genau ein neuer Eintrag „HLF 20 aus Bereitstellungsraum Sportplatz
  abgerufen nach EA Deich“

### Requirement: Abruf in einer Transaktion
Belegungsereignis, Unterstellung, Auftrag samt Anordnung und der ETB-Eintrag zum Abruf SHALL in
einer Transaktion entstehen; scheitert ein Teil, MUST nichts davon geschrieben sein.

#### Scenario: ETB scheitert
- **WHEN** beim Abruf mit Abschnitt das Schreiben des ETB-Eintrags scheitert
- **THEN** gibt es kein Abruf-Ereignis, die Unterstellung ist unverändert, und kein Auftrag ist
  angelegt

### Requirement: Rechte des Abrufs
Der Abruf und seine Rücknahme MUST das Schreibrecht auf das Modul Bereitstellungsräume im
Einsatz verlangen. Mit Ziel-Abschnitt MUST der Abruf zusätzlich das Recht am Modul Einheiten,
mit Auftragstext das Recht am Modul Aufträge verlangen und sonst mit 403 ablehnen, bevor etwas
gelesen oder geschrieben wird. Ein gekoppeltes Gerät MUST weder abrufen noch einen Abruf
zurücknehmen.

#### Scenario: Aufträge gesperrt
- **WHEN** eine Person ohne Recht am Modul Aufträge eine Kraft mit Auftragstext abruft
- **THEN** antwortet das System mit 403, und nichts ist geschrieben

#### Scenario: Einheiten gesperrt, ohne Abschnitt
- **WHEN** eine Person ohne Recht am Modul Einheiten eine Kraft ohne Abschnitt abruft
- **THEN** ist die Kraft abgerufen

#### Scenario: Beobachter
- **WHEN** ein Beobachter eine Kraft abruft
- **THEN** antwortet das System mit 403

### Requirement: Verband geht mit
Ruft die Führung eine Einheit ab, SHALL der Abruf ihre Untereinheiten über alle Ebenen
mitnehmen, die im selben Raum stehen und nicht schon abgerufen sind, je mit eigenem
Abruf-Ereignis, das auf den Abruf der Einheit verweist. Unterstellung und Auftrag MUST nur an der
abgerufenen Einheit gesetzt werden. Untereinheiten außerhalb des Raums und schon eigens
abgerufene Untereinheiten MUST unberührt bleiben. Der ETB-Eintrag MUST die mitgenommenen
Untereinheiten nennen.

#### Scenario: Zug mit Gruppen
- **WHEN** im BR Sportplatz der „1. Zug“ und seine Gruppen „Gruppe 1“ und „Gruppe 2“ stehen und
  die Führung den „1. Zug“ nach „EA Deich“ abruft
- **THEN** sind alle drei abgerufen, nur der „1. Zug“ ist „EA Deich“ unterstellt
- **AND** das ETB nennt „1. Zug mit Gruppe 1, Gruppe 2“

#### Scenario: Gruppe in anderem Raum
- **WHEN** „Gruppe 2“ im BR Schule steht und der „1. Zug“ aus dem BR Sportplatz abgerufen wird
- **THEN** bleibt „Gruppe 2“ im BR Schule unverändert

#### Scenario: Gruppe eigens abgerufen
- **WHEN** „Gruppe 1“ nach „EA Nord“ abgerufen ist und danach der „1. Zug“ nach „EA Deich“
  abgerufen wird
- **THEN** behält „Gruppe 1“ ihren Abruf nach „EA Nord“ und geht nicht mit dem „1. Zug“

### Requirement: Abgerufene Kraft bleibt im Raum, bis sie ausrückt
Eine Kraft SHALL als abgerufen gelten, solange ihr jüngstes Belegungsereignis ein Abruf in diesem
Raum ist; der Zustand MUST aus der Belegungsreihe abgeleitet werden. Eine abgerufene Kraft MUST
weiter im Raum stehen: in Belegung, Stärke und Kennzahlen des Raums, und ein Raum mit ihr MUST
sich nicht auflösen lassen.

#### Scenario: Stärke bleibt
- **WHEN** im BR Sportplatz zwei Einheiten stehen und eine davon abgerufen wird
- **THEN** zählt der BR Sportplatz weiter zwei Einheiten

### Requirement: Detail nennt den Abruf
Das Detail eines Raums MUST je abgerufener Einheit und je abgerufenem einheitenlosem Fahrzeug den
Zeitpunkt des Abrufs („abgerufen seit“), den Namen des Ziels und die Nummer des Auftrags tragen,
soweit vorhanden, bei einer mitgenommenen Untereinheit die Einheit, mit der sie abgerufen wurde.
Eine nicht abgerufene Kraft MUST keinen Abruf tragen.

#### Scenario: Abgerufen seit
- **WHEN** „HLF 20“ um 14:30 nach „EA Deich“ mit Auftrag Nr. 7 abgerufen wird
- **THEN** nennt das Detail bei „HLF 20“ „abgerufen seit“ 14:30, „EA Deich“ und Auftrag Nr. 7

### Requirement: Ausrücken nach dem Abruf
Ein Austritt über die Belegungsroute SHALL das Ausrücken einer abgerufenen Kraft buchen. War das
jüngste Ereignis ein Abruf, MUST der ETB-Eintrag das Ziel aus dem Abruf nennen, etwa „HLF 20
rückt aus Bereitstellungsraum Sportplatz aus nach EA Deich“; sonst MUST er wie bisher „verlässt
Bereitstellungsraum“ lauten. Der Austritt einer abgerufenen Einheit MUST in derselben
Transaktion die Untereinheiten austragen, die mit ihr abgerufen wurden und es noch sind; eigens
abgerufene oder zurückgenommene Untereinheiten MUST im Raum bleiben.

#### Scenario: Ausrücken bestätigt
- **WHEN** „HLF 20“ nach „EA Deich“ abgerufen ist und danach der Austritt gebucht wird
- **THEN** steht „HLF 20“ in keinem Raum mehr, und das ETB nennt „rückt aus Bereitstellungsraum
  Sportplatz aus nach EA Deich“

#### Scenario: Verband rückt aus
- **WHEN** der „1. Zug“ mit „Gruppe 1“ abgerufen ist und der Austritt für den „1. Zug“ gebucht
  wird
- **THEN** stehen „1. Zug“ und „Gruppe 1“ in keinem Raum mehr

### Requirement: Abrufen und sofort austragen
Mit `ausgerueckt: true` SHALL der Abruf in derselben Transaktion den Austritt jeder abgerufenen
Kraft schreiben. Der ETB-Eintrag MUST dann einer bleiben und das Ausrücken nennen.

#### Scenario: Lage ohne Einweiser
- **WHEN** die Führung „HLF 20“ nach „EA Deich“ mit `ausgerueckt: true` abruft
- **THEN** steht „HLF 20“ in keinem Raum mehr und ist „EA Deich“ unterstellt
- **AND** im ETB steht genau ein Eintrag „HLF 20 aus Bereitstellungsraum Sportplatz abgerufen
  nach EA Deich und ausgerückt“

### Requirement: Abruf zurücknehmen
Das System SHALL über `POST …/bereitstellungsraeume/{bid}/abruf/aufheben` einen Abruf
zurücknehmen, wenn das jüngste Ereignis der Kraft ein Abruf in diesem Raum ist, sonst 422. Die
Rücknahme MUST ein Ereignis der Art `abruf_aufgehoben` schreiben, die mit abgerufenen
Untereinheiten einschließen, einen ETB-Eintrag schreiben und Unterstellung und Auftrag unverändert
lassen. Danach MUST die Kraft wieder als bereitgestellt gelten.

#### Scenario: Fehlabruf
- **WHEN** „HLF 20“ irrtümlich abgerufen wurde und die Führung den Abruf zurücknimmt
- **THEN** gilt „HLF 20“ im BR Sportplatz wieder als bereitgestellt
- **AND** im ETB steht „Abruf von HLF 20 aus Bereitstellungsraum Sportplatz zurückgenommen“

#### Scenario: Nichts abgerufen
- **WHEN** die Führung den Abruf einer Kraft zurücknimmt, die nicht abgerufen ist
- **THEN** antwortet das System mit 422

### Requirement: Belegungsroute nimmt keinen Abruf an
`POST …/bereitstellungsraeume/{bid}/belegung` MUST die Arten `abruf` und `abruf_aufgehoben` mit
422 ablehnen und nichts schreiben. Einen Wechsel einer abgerufenen Kraft in einen anderen Raum
MUST die Route mit 422 ablehnen; erst die Rücknahme des Abrufs macht ihn möglich.

#### Scenario: Abruf über die Belegung
- **WHEN** jemand über die Belegungsroute eine Belegung mit der Art `abruf` schickt
- **THEN** antwortet das System mit 422

#### Scenario: Abgerufene Kraft verlegen
- **WHEN** „HLF 20“ im BR Sportplatz abgerufen ist und ein Wechsel in den BR Schule gebucht wird
- **THEN** antwortet das System mit 422, und „HLF 20“ steht weiter abgerufen im BR Sportplatz

### Requirement: Abruf live
Nach dem Commit eines Abrufs, einer Rücknahme oder eines Ausrückens SHALL das System für den
Raum das Live-Ereignis `bereitstellungsraum` senden, für jede betroffene Einheit `einheit`, für
ein einheitenloses Fahrzeug `fahrzeug`, mit Auftrag `auftrag` und für den ETB-Eintrag das
ETB-Ereignis. Einen Ton oder eine Benachrichtigung MUST der Abruf nicht auslösen.

#### Scenario: Gerät erfährt den Abruf
- **WHEN** die Führung eine Kraft aus dem BR Sportplatz mit Auftrag abruft und ein Gerät des BR
  Sportplatz verbunden ist
- **THEN** erhält das Gerät das Ereignis `bereitstellungsraum`, aber weder `etb` noch `auftrag`,
  und spielt keinen Ton

### Requirement: Eintreffen buchen in der Oberfläche
Die Detailseite eines Bereitstellungsraums SHALL am Desktop und am Gerät des Raums „Eintreffen
buchen“ im Kopf anbieten, als Primäraktion, solange der Raum `aktiv` ist. Der Dialog MUST die
aktiven Kräfte des Einsatzes ohne Raum durchsuchbar zeigen, „Erwartet“ vor „Im Einsatz“; ein
Tipp auf einen Treffer MUST ihn buchen. Ist der Raum nicht in Betrieb, MUST die Aktion gesperrt
mit Grund stehen; ohne Schreibrecht MUST sie fehlen.

#### Scenario: Ein Tipp bucht
- **WHEN** der Einweiser „HLF“ sucht und den Treffer „HLF 20 FF Musterstadt“ tippt
- **THEN** ist die Einheit gebucht, der Dialog schließt, und ein Hinweis nennt „HLF 20 FF Musterstadt gebucht“

#### Scenario: Schon eingetroffen
- **WHEN** eine Einheit ohne Abschnitt in ihrer offenen Periode schon eingetroffen ist und in keinem Raum steht
- **THEN** steht sie im Dialog unter „Im Einsatz“, nicht unter „Erwartet“

#### Scenario: Raum geplant
- **WHEN** der Raum den Status `geplant` hat
- **THEN** steht „Eintreffen buchen“ gesperrt mit dem Grund „BR nicht in Betrieb“

#### Scenario: Am Gerät
- **WHEN** der Einweiser am Tablet des Raums „Eintreffen buchen“ wählt
- **THEN** füllt der Dialog den Bildschirm

#### Scenario: Anderes Gerät
- **WHEN** ein Gerät einer anderen Ansicht als `bereitstellungsraum` die Seite eines Raums zeigt
- **THEN** fehlt „Eintreffen buchen“

### Requirement: Erwartete Kräfte aus Nachforderungen im Dialog
Der Dialog „Eintreffen buchen“ SHALL über „Erwartet“ die Gruppe „Aus Nachforderungen“ zeigen: je
offenem Rufnamen einer Nachforderung mit Ziel = dieser Raum eine Zeile mit Art, Nachforderung,
Stufe und erwartetem Eintreffen, dazu eine Zeile „ohne Rufname“, solange mehr erwartet wird, als
Rufnamen genannt sind (LLH-1387). „Eintreffen“ an einer Zeile MUST eine gleichnamige buchbare
Einheit mit Verweis auf die Nachforderung buchen, sonst die Erfassung mit Rufname als Funkrufname
und Art als Fahrzeugtyp öffnen, die mit „Eintreffen buchen“ ebenfalls mit Verweis bucht. Eine so
angebotene Einheit MUST NOT zusätzlich unter „Erwartet“ oder „Im Einsatz“ stehen. Ohne Freigabe
Nachforderungen MUST die Gruppe ohne Fehlermeldung fehlen.

#### Scenario: Erwartete Kraft buchen
- **WHEN** die Nachforderung „2× RTW“ mit Ziel „BR Sportplatz“ und Zusage „83-1“, „83-2“ unterwegs ist und im Einsatz keine Kraft „83-2“ geführt wird
- **AND** der Einweiser im Dialog unter „Aus Nachforderungen“ bei „83-2“ „Eintreffen“ und dann „Eintreffen buchen“ wählt
- **THEN** ist „83-2“ als Einheit mit Verweis auf die Nachforderung im Raum gebucht, und die Nachforderung nennt sie

#### Scenario: Gleichnamige Einheit
- **WHEN** im Einsatz die Einheit „83-1“ ohne Raum geführt wird
- **THEN** bucht „Eintreffen“ bei „83-1“ unter „Aus Nachforderungen“ diese Einheit mit Verweis, und „83-1“ steht nicht noch einmal unter „Erwartet“

### Requirement: Unangemeldete Kraft in der Oberfläche erfassen
„Nicht in der Liste“ im Dialog „Eintreffen buchen“ SHALL die Erfassung einer unangemeldeten
Kraft mit vier sichtbaren Feldern öffnen (Funkrufname, Trägerorganisation, Fahrzeugtyp, Stärke),
Bemerkung und weitere Fahrzeuge aufklappbar, den Suchtext als Funkrufname übernommen.
Ablehnungen MUST im Dialog stehen, ohne Fehler-Toast.

#### Scenario: Unangemeldet gebucht
- **WHEN** der Einweiser „Nicht in der Liste“ wählt, den Funkrufnamen ergänzt und „Unangemeldet buchen“ wählt
- **THEN** zeigt ein Hinweis „FL-MUS 1-44-1 unangemeldet gebucht, Einsatzleitung informiert“

### Requirement: Doppelbuchung in der Oberfläche
Erkennt der Client bei der Erfassung einer unangemeldeten Kraft eine Doppelbuchung, SHALL er die
vorhandene Kraft nennen, „Unangemeldet buchen“ sperren und „Trotzdem neu anlegen“ anbieten, dazu
„Diese buchen“, solange die vorhandene Kraft in keinem Raum steht (dort hilft der Wechsel). Meldet
erst der Server die Doppelbuchung, MUST „Trotzdem neu anlegen“ erscheinen.

#### Scenario: Doppelbuchung im Client
- **WHEN** der Einweiser unangemeldet „fl-mus 1-44-1“ eingibt und „FL-MUS 1-44-1“ als Fahrzeug im Einsatz geführt wird
- **THEN** nennt der Dialog „Schon im Einsatz: FL-MUS 1-44-1“, „Unangemeldet buchen“ ist gesperrt, und „Trotzdem neu anlegen“ sendet die Erfassung mit ausdrücklicher Bestätigung

#### Scenario: Doppelbuchung mit einer Kraft im Raum
- **WHEN** der Einweiser unangemeldet „Zug Süd“ eingibt und die Einheit „Zug Süd“ in einem Bereitstellungsraum steht
- **THEN** nennt der Dialog „Schon im Einsatz: Zug Süd“ und bietet nur „Trotzdem neu anlegen“, „Diese buchen“ fehlt

### Requirement: Seitenleiste trennt Erwartete und Kräfte im Einsatz
Die Seitenleiste der freien Kräfte SHALL Kräfte ohne Raum in „Erwartet“ (ohne eigenen oder
geerbten Abschnitt, dazu Fahrzeuge ohne Einheit) und „Im Einsatz“ (mit Abschnitt) trennen;
„Im Einsatz“ MUST eingeklappt mit Anzahl stehen und aufklappbar sein.

#### Scenario: Kraft im Abschnitt
- **WHEN** eine Einheit mit Abschnitt Nord in keinem Raum steht
- **THEN** steht sie in der Seitenleiste unter „Im Einsatz“, das eingeklappt die Anzahl nennt

#### Scenario: Unterstellte Einheit
- **WHEN** eine Einheit ohne eigenen Abschnitt einer Einheit im Abschnitt Nord unterstellt ist
- **THEN** steht sie unter „Im Einsatz“

### Requirement: Herkunft in der Belegung
Die Belegungszeile einer Einheit SHALL „nicht übernommen“ in der Rolle Achtung zeigen, solange
die Übernahme offen ist, und danach „unangemeldet“ als neutrale Marke ohne Farbe.

#### Scenario: Nach der Übernahme
- **WHEN** eine unangemeldet gebuchte Einheit übernommen wurde und weiter im Raum steht
- **THEN** zeigt ihre Belegungszeile „unangemeldet“ ohne Farbe und nicht „nicht übernommen“

### Requirement: Eintreffen ohne Netz vormerken
Die Oberfläche SHALL ein Eintreffen (bekannte wie unangemeldete Kraft), das mangels Verbindung
nicht gesendet werden kann, auf dem Gerät vormerken und bei Verbindung nachsenden. Jede Buchung
MUST vor dem ersten Sendeversuch eine `client_id` erhalten, die auch die vorgemerkte Kopie
trägt, damit eine Wiederholung nach abgerissener Antwort höchstens einmal wirkt. Vorgemerkt
MUST sie den Erfassungszeitpunkt nach der Serveruhr tragen, soweit deren Versatz bekannt ist.

#### Scenario: Ohne Netz gebucht
- **WHEN** der Einweiser am Tablet ohne Netz „HLF 20 FF Musterstadt“ bucht
- **THEN** lautet der Hinweis „Offline vorgemerkt: Eintreffen HLF 20 FF Musterstadt“, und nichts geht an den Server

#### Scenario: Abgerissene Antwort
- **WHEN** die Buchung den Server erreicht, die Antwort aber ausbleibt, und die Queue sie später erneut sendet
- **THEN** trägt der zweite Versuch dieselbe `client_id`, der Server liefert die erste Buchung, und es gibt genau eine Einheit, einen Belegungseintrag und eine Meldung

### Requirement: Vorgemerkte Eintreffen am Raum
Die Seite des Raums SHALL die vorgemerkten Buchungen dieses Geräts für diesen Raum unter
„Vorgemerkt“ zeigen, mit Kraft und Zeitpunkt der Erfassung, getrennt von der Belegung und ohne
sie in die Kennzahlen zu zählen. Beim Nachsenden MUST der Raum neu geladen sein, bevor die Zeile
„Vorgemerkt“ verschwindet.

#### Scenario: Vorgemerkt am Raum
- **WHEN** am Tablet des BR Sportplatz ohne Netz „HLF 20 FF Musterstadt“ gebucht ist
- **THEN** steht die Kraft unter „Vorgemerkt“ mit „vorgemerkt“ und der Uhrzeit, und „Einheiten“ zählt sie nicht

### Requirement: Ablehnung eines vorgemerkten Eintreffens
Eine beim Nachsenden fachlich abgelehnte Buchung (etwa 422 für einen inzwischen aufgelösten
Raum, 409 für eine Kraft, die schon in einem Raum steht, 403) SHALL mit Kraft, Raum, Grund und
vollständigem Inhalt im Wiederherstellungsbereich stehen, bis sie verworfen oder erneut versucht
wird.

#### Scenario: Raum beim Nachsenden aufgelöst
- **WHEN** eine vorgemerkte Buchung nachgesendet wird und der Raum inzwischen aufgelöst ist
- **THEN** steht sie unter „Offline-Aktionen wiederherstellen“ als „Abgelehntes Eintreffen: … · BR …“ mit dem Grund, und „Vorgemerkt“ am Raum ist leer

### Requirement: Doppelbuchung ohne Netz
Eine Kraft, deren Buchung vorgemerkt ist, SHALL im Dialog gesperrt mit „vorgemerkt …“ stehen und
MUST NOT als Treffer für „Diese buchen“ gelten. Trägt eine vorgemerkte unangemeldete Kraft
denselben Funkrufnamen wie die Eingabe, MUST der Dialog „Schon vorgemerkt: …“ nennen und nur
„Trotzdem neu anlegen“ anbieten. Fehlen dem Dialog die Kräfte des Einsatzes, MUST er keine
Doppelbuchung melden; die Prüfung trägt dann der Server beim Senden.

#### Scenario: Schon vorgemerkte Kraft
- **WHEN** der Einweiser ohne Netz „RTW 2“ gebucht hat und danach unangemeldet „rtw 2“ erfasst
- **THEN** nennt der Dialog „Schon vorgemerkt: RTW 2“, „Diese buchen“ fehlt, und der Treffer „RTW 2“ in der Suche ist gesperrt

### Requirement: Abruf in der Oberfläche
Die Detailseite eines aktiven Raums SHALL je bereitgestellter Einheit und je einheitenlosem
Fahrzeug „Abrufen“ als Hauptaktion anbieten. „Abrufen und austragen“ (Abruf mit
`ausgerueckt: true`) und „Austragen“ (Austritt) MUST als Nebenwege im Aktionsmenü der Zeile
stehen; die Belegung MUST keinen roten Knopf tragen. Eine Mehrfachauswahl gibt es nicht; ein
Verband geht mit seiner Einheit.

#### Scenario: Kein roter Knopf
- **WHEN** die Führung einen aktiven Raum mit bereitgestellten Kräften öffnet
- **THEN** trägt jede Zeile „Abrufen“ und ein Aktionsmenü mit „Abrufen und austragen“ und
  „Austragen“, und die Belegung zeigt keinen roten Knopf

### Requirement: Felder des Abruf-Dialogs
Der Abruf-Dialog SHALL einen Ziel-Abschnitt, nur bei einer Einheit und vorbelegt mit dem
Abschnitt des Raums, und einen Auftrag anbieten, beide optional; ein leeres Feld MUST nicht
gesendet werden. Nimmt eine Einheit Untereinheiten mit, MUST der Dialog sie am Knopf nennen. Eine
Ablehnung des Servers MUST im Dialog stehen, ohne Fehler-Toast.

#### Scenario: Abrufen mit Ziel und Auftrag
- **WHEN** die Führung bei „HLF 20“ im BR Sportplatz „Abrufen“ wählt, „EA Deich“ und den Auftrag
  „Sandsackverbau“ einträgt und „Abrufen“ wählt
- **THEN** geht ein Abruf mit Abschnitt „EA Deich“ und Auftragstext „Sandsackverbau“ hinaus, und
  ein Hinweis nennt „HLF 20 abgerufen → EA Deich · Auftrag Nr. 7“

#### Scenario: Ohne Einweiser
- **WHEN** die Führung im Aktionsmenü von „HLF 20“ „Abrufen und austragen“ wählt und bestätigt
- **THEN** geht ein Abruf mit `ausgerueckt: true` hinaus, und „HLF 20“ steht in keinem Raum mehr

#### Scenario: Fahrzeug ohne Einheit
- **WHEN** die Führung ein einheitenloses Fahrzeug abruft
- **THEN** bietet der Dialog keinen Ziel-Abschnitt an

### Requirement: Rechte der Abruf-Felder in der Oberfläche
Fehlt der Person das Modul Einheiten oder Einsatzabschnitte, SHALL der Ziel-Abschnitt gesperrt
mit Grund stehen; fehlt das Modul Aufträge, der Auftrag. Ein gesperrtes Feld MUST NOT gesendet
werden.

#### Scenario: Aufträge gesperrt
- **WHEN** eine Person ohne Freigabe Aufträge den Abruf-Dialog öffnet
- **THEN** steht der Auftrag gesperrt mit „Modul Aufträge gesperrt“, und der Abruf geht ohne
  Auftragstext hinaus

### Requirement: Abgerufene Kräfte in der Oberfläche
Abgerufene Kräfte SHALL auf der Detailseite und am Gerät des Raums getrennt über den
bereitgestellten unter „Abgerufen“ stehen, mit dem Wort „abgerufen“ in der Rolle Achtung, der
taktischen Uhrzeit des Abrufs, dem Ziel und der Auftragsnummer, eine mitgenommene Untereinheit
mit „mit …“ und ihrer Einheit, die am längsten abgerufene zuerst. Fremde Abrufe MUST der
Zuflussschleuse der Belegung folgen, eigene MUST sofort stehen.

#### Scenario: Abgerufen oben
- **WHEN** „HLF 20“ um 14:32 nach „EA Deich“ mit Auftrag Nr. 7 abgerufen ist
- **THEN** steht „HLF 20“ unter „Abgerufen“ mit „abgerufen 1432 → EA Deich · Auftrag Nr. 7“ und
  nicht unter „Bereitgestellte Einheiten“, und die Kennzahl „Einheiten“ zählt es weiter

#### Scenario: Mitgenommene Untereinheit im Verlauf
- **WHEN** „Gruppe 1“ mit dem „1. Zug“ nach „EA Deich“ abgerufen wurde
- **THEN** nennt der Verlauf „Abruf mit 1. Zug nach EA Deich“

### Requirement: Ausrücken und Rücknahme in der Oberfläche
Je abgerufener Kraft SHALL „Ausrücken buchen“ den Austritt buchen, auch am Gerät des Raums;
„Abruf zurücknehmen“ MUST nur die Führung angeboten bekommen.

#### Scenario: Ausrücken am Gerät
- **WHEN** der Einweiser am Tablet des BR Sportplatz bei „HLF 20“ „Ausrücken buchen“ wählt
- **THEN** ist der Austritt gebucht, und ein Hinweis nennt „Einheit „HLF 20“ ausgerückt“

#### Scenario: Fehlabruf zurücknehmen
- **WHEN** die Führung bei „HLF 20“ „Abruf zurücknehmen“ wählt
- **THEN** ist der Abruf zurückgenommen, und „HLF 20“ steht wieder unter „Bereitgestellte
  Einheiten“
