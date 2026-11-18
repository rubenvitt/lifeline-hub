# Spec Delta

## Purpose

Was der Server und jede App-Hülle einander zusagen, damit eine Hülle mit möglichst vielen
Server-Versionen läuft: den Vertrag unter `GET /api/huelle` und die Felder der Kennung
`window.__LIFELINE_HUELLE__`, die eine Hülle der geladenen Seite gibt.

## ADDED Requirements

### Requirement: Der Server nennt Version und Hüllen-Vertrag ohne Anmeldung
Der Server MUST unter `GET /api/huelle` ohne Sitzung mit 200 und einem JSON-Objekt antworten, das
mindestens `version` (die laufende Anwendungsversion als Zeichenkette) und `huelle_vertrag` (eine
ganze Zahl ≥ 1) enthält. Die Antwort MUST auch für Gerätesitzungen und unabhängig vom Zustand der
Datenbank gelten. Neue Felder MUST nur hinzukommen; bestehende Felder MUST NOT umbenannt, entfernt
oder in ihrer Bedeutung geändert werden.

#### Scenario: Anonymer Abruf
- **WHEN** eine Hülle ohne Cookie `GET /api/huelle` aufruft
- **THEN** antwortet der Server mit 200, `version` gleich der Version aus `GET /api/health` und `huelle_vertrag` als ganze Zahl

#### Scenario: Gerätesitzung
- **WHEN** ein gekoppeltes Gerät mit seiner Sitzung `GET /api/huelle` aufruft
- **THEN** antwortet der Server mit 200 und denselben Feldern

#### Scenario: Zusätzliches Feld
- **WHEN** eine spätere Server-Version ein weiteres Feld in die Antwort aufnimmt
- **THEN** bleiben `version` und `huelle_vertrag` mit derselben Bedeutung erhalten

### Requirement: Der Hüllen-Vertrag steigt nur bei einem Bruch
`huelle_vertrag` MUST nur steigen, wenn eine Hülle, die den bisherigen Wert kennt, mit dem Server
nicht mehr richtig arbeiten kann. Eine Erweiterung, die ältere Hüllen nicht stört, MUST den Wert
unverändert lassen. Der erste Wert ist 1.

#### Scenario: Neue Hüllen-Funktion
- **WHEN** der Server eine neue, optionale Fähigkeit für Hüllen anbietet
- **THEN** bleibt `huelle_vertrag` gleich

### Requirement: Die Kennung der Hülle nennt Plattform, Version und Haptik
Setzt eine Hülle in der Kennung `window.__LIFELINE_HUELLE__` die Felder `platform`, `version`
oder `haptik`, MUST `platform` das Kennwort der Plattform sein (die iOS-Hülle MUST `'ios'`
setzen), `version` ihre volle Versionsangabe und `haptik(art)` eine Funktion. Das Frontend MUST
jedes Feld einzeln prüfen, ohne das Feld so arbeiten wie bisher und die Kennung an genau einer
Stelle lesen.

#### Scenario: Ältere Hülle ohne Haptik
- **WHEN** die Seite in einer Hülle läuft, deren Kennung kein `haptik` trägt
- **THEN** löst das Frontend keine Haptik aus und zeigt keinen Fehler

#### Scenario: Browser ohne Kennung
- **WHEN** die Seite im Browser läuft
- **THEN** verhalten sich Erfassung, Alarm und Segmentleiste wie bisher

### Requirement: Haptik kennt fünf Arten und wirft nie
`haptik` MUST die Arten `erfolg`, `warnung`, `fehler`, `auswahl` und `tippen` annehmen, für eine
unbekannte Art nichts tun und nie werfen. Ein Fehler der Haptik MUST das Ergebnis der Handlung,
die sie ausgelöst hat, unverändert lassen.

#### Scenario: Unbekannte Art
- **WHEN** das Frontend `haptik('unbekannt')` aufruft
- **THEN** passiert nichts, und es entsteht kein Fehler

#### Scenario: Haptik wirft
- **WHEN** der Aufruf von `haptik` in der Hülle scheitert
- **THEN** gilt die Erfassung trotzdem als gespeichert

### Requirement: Erfassungen geben haptische Rückmeldung
Läuft die Seite in einer Hülle mit `haptik`, MUST das Frontend bei der gemeinsamen Erfassung und
der ETB-Schnellerfassung genau einmal auslösen: `erfolg`, wenn der Server die Erfassung annimmt;
`tippen`, wenn sie ohne Netz nur vorgemerkt wird; `fehler`, wenn der Server sie ablehnt.

#### Scenario: Angenommener ETB-Eintrag
- **WHEN** jemand in der iOS-App einen ETB-Eintrag speichert und der Server ihn annimmt
- **THEN** löst das Frontend genau einmal `erfolg` aus

#### Scenario: Vorgemerkt ohne Netz
- **WHEN** jemand ohne Verbindung zum Server einen ETB-Eintrag speichert
- **THEN** löst das Frontend `tippen` aus, nicht `erfolg`

#### Scenario: Abgelehnte Erfassung
- **WHEN** der Server eine Erfassung mit einem Fehler ablehnt
- **THEN** löst das Frontend `fehler` aus

### Requirement: Alarm und Segmentwechsel geben haptische Rückmeldung
Läuft die Seite in einer Hülle mit `haptik`, MUST das Frontend bei einem neu eingehenden Alarm der
Stufe `alarm` einmal `warnung` auslösen, nicht beim Nachspielen eines gezeigten Alarms und nicht
bei stummgeschaltetem Alarm. Bei einem Wechsel in einer Segmentleiste MUST es einmal `auswahl`
auslösen. Weitere Stellen MUST ohne Haptik bleiben.

#### Scenario: Neuer Alarm
- **WHEN** in der iOS-App ein Alarm der Stufe `alarm` eingeht
- **THEN** löst das Frontend einmal `warnung` aus

#### Scenario: Alarm nachgespielt
- **WHEN** ein bereits gezeigter Alarm nach einem Neuladen erneut angezeigt wird
- **THEN** löst das Frontend keine Haptik aus

#### Scenario: Segmentwechsel
- **WHEN** jemand in einer Segmentleiste ein anderes Segment wählt
- **THEN** löst das Frontend genau einmal `auswahl` aus
