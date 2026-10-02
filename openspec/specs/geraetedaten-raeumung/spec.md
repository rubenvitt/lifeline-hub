# geraetedaten-raeumung Specification

## Purpose
Legt fest, welche personenbezogenen Daten ein gemeinsam genutztes Gerät nach Abmelden,
Sitzungsende und Benutzerwechsel noch tragen darf, an wen gebunden und wie lange. Das
vorgehaltene Lagebild regelt `lagebild-offline-lesen`.

## Requirements

### Requirement: Abmelden räumt alle personenbezogenen Daten außer der Offline-Queue

Meldet sich eine Person ab, MUST das System alle personenbezogenen Daten dieser Person vom
Gerät löschen: Erfassungsquittungen, ETB-Entwürfe, Ortscache und die Sitzungswerte der
Erfassungsmasken. Die vorgemerkten und abgelehnten Einträge der Offline-Queue MUST unverändert
bleiben.

#### Scenario: Nach dem Abmelden liegt nichts mehr auf dem Gerät

- **WHEN** eine Person mit gespeichertem ETB-Entwurf, ungelesener Personen-Erfassungsquittung
  und gefülltem Ortscache sich abmeldet
- **THEN** enthält der geräteseitige Speicher danach weder Entwurf noch Quittung noch
  Ortsnamen

#### Scenario: Die Offline-Queue bleibt

- **WHEN** eine Person mit vorgemerkten, noch nicht gesendeten Einträgen sich abmeldet
- **THEN** bleiben diese Einträge samt den abgelehnten in der Offline-Queue erhalten

#### Scenario: Abmelden scheitert am Server

- **WHEN** die Abmeldung am Server mit einem Netzfehler scheitert und das System lokal abmeldet
- **THEN** räumt das System das Gerät genauso wie bei einer erfolgreichen Abmeldung

### Requirement: ETB-Entwürfe gehören dem Benutzer, der sie geschrieben hat

Das System MUST jeden ETB-Entwurf an den Benutzer binden, der ihn angelegt hat. Ein Benutzer
MUST nur seine eigenen Entwürfe sehen, auch am selben Gerät und im selben Einsatz.

#### Scenario: Zweiter Benutzer sieht keine fremden Entwürfe

- **WHEN** Benutzer A im Einsatz 7 einen Entwurf schreibt, seine Sitzung abläuft und Benutzer B
  sich am selben Gerät anmeldet und das ETB von Einsatz 7 öffnet
- **THEN** zeigt das ETB für B keinen Entwurf von A, weder im Tab noch nach einem Neuladen

#### Scenario: Anmeldung eines anderen Benutzers räumt fremde Entwürfe

- **WHEN** sich nach einem Sitzungsablauf von A ein anderer Benutzer B am Gerät anmeldet
- **THEN** löscht das System die Entwürfe von A vom Gerät

### Requirement: Entwürfe überleben ein Sitzungsende gebunden und befristet

Endet die Sitzung mit 401, MUST das System die ETB-Entwürfe der Person auf dem Gerät behalten.
Meldet sich dieselbe Person wieder an, MUST sie ihre Entwürfe unverändert vorfinden. Daten, die
der Server wieder liefern kann (Erfassungsquittungen, Ortscache, Sitzungswerte der
Erfassungsmasken), MUST das System auch beim Sitzungsende löschen.

#### Scenario: Wiederanmeldung nach Sitzungsablauf

- **WHEN** die Sitzung einer Person mit offenem ETB-Entwurf mit 401 endet und dieselbe Person
  sich innerhalb von 24 Stunden wieder anmeldet
- **THEN** findet sie den Entwurf mit seinem Text im ETB wieder

#### Scenario: Sitzungsende räumt die Quittungen

- **WHEN** die Sitzung einer Person mit ungelesener Personen-Erfassungsquittung mit 401 endet
- **THEN** enthält der geräteseitige Speicher danach keine Quittung mehr

#### Scenario: Sitzungsende erst beim Start bemerkt

- **WHEN** die App startet und der Server die Sitzungsprüfung ablehnt (etwa mit 401)
- **THEN** löscht das System Quittungen, Ortscache und Erfassungswerte und behält die
  ETB-Entwürfe

#### Scenario: Netzfehler beim Start ist kein Sitzungsende

- **WHEN** die App startet und die Sitzungsprüfung an einem Netzfehler scheitert
- **THEN** löscht das System keine Gerätedaten

### Requirement: Höchstliegezeit von 24 Stunden ohne angemeldeten Besitzer

Entwürfe und Erfassungsquittungen, deren Besitzer nicht angemeldet ist, MUST das System
spätestens 24 Stunden nach ihrer letzten Änderung löschen. Geprüft wird beim Start der App und
bei jeder Anmeldung. Entwürfe der angemeldeten Person MUST unabhängig von ihrem Alter erhalten
bleiben.

#### Scenario: Verwaister Entwurf nach mehr als 24 Stunden

- **WHEN** die App startet und ein Entwurf vorliegt, dessen Besitzer nicht angemeldet ist und
  dessen letzte Änderung mehr als 24 Stunden zurückliegt
- **THEN** löscht das System diesen Entwurf

#### Scenario: Eigener Entwurf bleibt auch nach langer Zeit

- **WHEN** eine angemeldete Person einen Entwurf hat, den sie seit 30 Stunden nicht geändert
  hat
- **THEN** bleibt der Entwurf erhalten

### Requirement: Jeder geräteseitige Speicherort hat eine begründete Entscheidung

Jeder Ort, an dem das Frontend Daten auf dem Gerät ablegt (IndexedDB, `localStorage`,
`sessionStorage`), MUST in einem Verzeichnis mit einer Entscheidung stehen: räumen, binden und
befristen oder bewusst stehen lassen, jeweils mit Begründung. Ein neuer Speicherort ohne
Eintrag MUST die Prüfung rot machen.

#### Scenario: Neuer Speicherort ohne Entscheidung

- **WHEN** eine Änderung eine neue IndexedDB öffnet oder eine Datei neu in `localStorage` oder
  `sessionStorage` schreiben lässt, ohne sie im Verzeichnis einzutragen
- **THEN** schlägt die Prüfung fehl und nennt den Ort

#### Scenario: Bewusst stehen gelassene Geräte-Einstellung

- **WHEN** eine Person das Farbschema auf dunkel stellt und sich abmeldet
- **THEN** bleibt das Farbschema am Gerät erhalten, weil es im Verzeichnis als
  Geräte-Einstellung ohne Personenbezug steht
