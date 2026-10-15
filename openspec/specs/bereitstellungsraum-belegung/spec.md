# bereitstellungsraum-belegung Specification

## Purpose
Ein Bereitstellungsraum zeigt, wer wie lange wartet: je Kraft im Raum den Zeitpunkt, seit dem
sie dort steht, zu jeder Einheit ihre Fahrzeuge, je Raum die Kennzahlen der Belegung (Einheiten,
Fahrzeuge einschließlich der Fahrzeuge der Einheiten, längste Wartezeit) und die vollständige
Reihe seiner Belegungsereignisse. Liste und Detail lesen dieselben Kennzahlen, das gekoppelte
Gerät des Raums liest den Verlauf des eigenen Raums mit. Detailseite, Liste und Druck zeigen diese
Werte mit laufender Wartezeit, die Belegung am längsten wartend zuerst und den Verlauf in einem
Aufklappbereich, der erst beim Aufklappen lädt.

## Requirements

### Requirement: Wartezeit je Kraft im Raum
Das Detail eines Bereitstellungsraums SHALL für jede Einheit und jedes einheitenlose Fahrzeug,
das im Raum steht, den Zeitpunkt nennen, seit dem es dort steht („seit“). „Seit“ MUST der
Zeitpunkt des jüngsten Belegungsereignisses des Objekts sein, gemessen an der
Erfassungsreihenfolge, und MUST nur dann gesetzt sein, wenn dieses Ereignis ein Eintritt oder
ein Wechsel in genau diesen Raum ist; sonst MUST „seit“ fehlen. Ein früherer Eintritt in einen
anderen Raum MUST „seit“ nicht bestimmen. Zeitpunkte MUST als UTC ohne Zonenkennung
(`YYYY-MM-DD HH:MM:SS`) übertragen werden.

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
Raum, Wechsel aus dem Raum in einen anderen Raum und Austritte enthalten, auch Austritte durch
Auflösen einer Einheit oder Entlassen eines Fahrzeugs. Jeder Eintrag MUST Zeitpunkt, Art,
Objekttyp, Objektkennung, Objektname und, falls erfasst, die Notiz tragen; ein Wechsel in den Raum
MUST den Herkunftsraum, ein Wechsel aus dem Raum den Zielraum nennen. Ein Objekt, das inzwischen
aufgelöst oder entlassen ist, MUST mit seinem Namen erscheinen. Auch ein stornierter oder
aufgelöster Raum MUST seine Reihe liefern. Ein Raum eines anderen Einsatzes oder ein unbekannter
Raum MUST mit 404 antworten.

#### Scenario: Reihe mit Wechsel und Austritt
- **WHEN** „1. Zug“ in den BR Sportplatz eintritt, danach in den BR Schule wechselt und dort
  austritt
- **THEN** zeigt die Reihe des BR Sportplatz „Wechsel nach BR Schule“ vor „Eintritt“
- **AND** die Reihe des BR Schule zeigt „Austritt“ vor „Wechsel von BR Sportplatz“

#### Scenario: Austritt durch Auflösen
- **WHEN** eine Einheit, die im BR Sportplatz steht, aufgelöst wird
- **THEN** zeigt die Reihe des BR Sportplatz einen Austritt dieser Einheit mit der Notiz
  „Einheit aufgelöst“

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
Listen. Die Stärke MUST über dieselbe Summenfunktion wie die übrige Anwendung entstehen; fehlt
eine Einheit des Raums in der Einheitenliste, MUST statt einer Zahl „—“ mit Grund stehen. Ohne
frühesten „seit“-Zeitpunkt MUST „Längste Wartezeit“ „—“ zeigen. Die Zahl der Belegungen, die vor
dem Auflösen genannt wird („noch n belegt“), MUST weiter nur Einheiten und einheitenlose
Fahrzeuge zählen, wie die Sperre des Servers beim Auflösen.

#### Scenario: Fahrzeuge 3
- **WHEN** im Raum zwei Einheiten mit je einem Fahrzeug und ein Fahrzeug ohne Einheit stehen
- **THEN** zeigt die Kennzahl „Fahrzeuge“ 3 und „Einheiten“ 2
- **AND** nennt die Seite vor dem Auflösen „noch 3 belegt“

### Requirement: Zeile je Kraft mit Wartezeit
Die Detailseite SHALL je Einheit im Raum Name, Typ, Stärke, die Funkrufnamen ihrer Fahrzeuge und
„seit <Uhrzeit> · <Dauer>“ zeigen, je einheitenlosem Fahrzeug Funkrufnamen, Typ und „seit …“. Die
Dauer MUST ohne neuen Abruf mit der Uhr weiterlaufen (höchstens eine Minute Versatz) und MUST
nie negativ sein. Ohne „seit“ MUST die Zeile keine Zeitangabe tragen.

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
denen der Detailseite desselben Raums gleichen; die Stärke MUST über dieselbe Summenfunktion und
Formatierung wie die Detailseite entstehen. Ist die Einheitenliste nicht verfügbar oder fehlt
eine Einheit des Raums darin, MUST „Stärke“ „—“ zeigen.

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
