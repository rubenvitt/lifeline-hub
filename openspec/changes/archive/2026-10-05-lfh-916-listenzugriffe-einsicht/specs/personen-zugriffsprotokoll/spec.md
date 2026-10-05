# Spec Delta

## Purpose

Macht das Zugriffsprotokoll der Personen eines Einsatzes für die Einsatzleitung einsehbar: je
Person und für die Zugriffe auf die ganze Personenliste, damit Datenschutz-Auskünfte und die
Aufsicht über Export und Druck ohne Datenbankzugriff möglich sind.

## ADDED Requirements

### Requirement: Einsicht in die listenweiten Zugriffe

Das System SHALL der Einsatzleitung je Einsatz alle Protokolleinträge zeigen, die die ganze
Personenliste betreffen (Export und Druck der Liste), jeweils mit Zeitpunkt, abrufendem Benutzer
und Art, die neuesten zuerst. Einträge zu einer einzelnen Person und Einträge anderer Einsätze
MUST NOT in dieser Einsicht erscheinen.

#### Scenario: Export und Druck erscheinen

- **WHEN** im Einsatz die Personenliste um 10:00 exportiert und um 10:05 gedruckt wurde und die
  Einsatzleitung die listenweiten Zugriffe öffnet
- **THEN** sieht sie zwei Einträge, zuerst „Liste gedruckt“ (10:05), dann „Liste exportiert“
  (10:00), jeweils mit dem Benutzer, der abgerufen hat

#### Scenario: Personenbezogene Zugriffe bleiben draußen

- **WHEN** im Einsatz eine Person geöffnet und eine Datei einer Person geladen wurde, aber
  niemand die Liste exportiert oder gedruckt hat
- **THEN** ist die Einsicht der listenweiten Zugriffe leer

#### Scenario: Andere Einsätze bleiben draußen

- **WHEN** die Personenliste eines anderen Einsatzes exportiert wurde
- **THEN** erscheint dieser Export nicht in der Einsicht dieses Einsatzes

#### Scenario: Abgeschlossener Einsatz

- **WHEN** die Einsatzleitung die listenweiten Zugriffe eines abgeschlossenen Einsatzes öffnet
- **THEN** sieht sie dessen Einträge wie bei einem laufenden Einsatz

### Requirement: Nur die Einsatzleitung sieht das Zugriffsprotokoll

Die Einsicht in die listenweiten Zugriffe und die Einsicht je Person MUST nur der Einsatzleitung
des Einsatzes offenstehen. Jede andere Rolle MUST eine Ablehnung (403) erhalten. Die Oberfläche
SHALL den Zugang zur Einsicht nur der Einsatzleitung anbieten.

#### Scenario: Führungspersonal fragt an

- **WHEN** ein Mitglied mit der Rolle Führungspersonal die listenweiten Zugriffe abruft
- **THEN** antwortet der Server mit 403 und liefert keine Einträge

#### Scenario: Beobachter fragt an

- **WHEN** ein Beobachter die listenweiten Zugriffe abruft
- **THEN** antwortet der Server mit 403

#### Scenario: Kein Knopf ohne Leitung

- **WHEN** Führungspersonal die Personenliste öffnet
- **THEN** zeigt die Seite keinen Zugang zu den listenweiten Zugriffen

### Requirement: Die Einsicht ist unprotokolliert

Das Öffnen der Einsicht in die listenweiten Zugriffe und der Einsicht je Person MUST NOT einen
Eintrag im Zugriffsprotokoll erzeugen. Die Oberfläche MUST die listenweiten Zugriffe erst laden,
wenn die Einsatzleitung die Einsicht öffnet, und SHALL sie nicht live nachladen.

#### Scenario: Einsicht zweimal öffnen

- **WHEN** die Einsatzleitung die listenweiten Zugriffe zweimal hintereinander öffnet
- **THEN** bleibt die Zahl der Protokolleinträge des Einsatzes unverändert

### Requirement: Einsicht je Person zeigt die Listenzugriffe, die sie erfasst haben

Die Einsicht je Person SHALL neben den Zugriffen auf diese Person auch jeden listenweiten Zugriff
zeigen, der nach ihrer Erfassung und nicht nach ihrer Stornierung geschah, mit derselben Art wie
in der listenweiten Einsicht, alles gemeinsam die neuesten zuerst. Im Zweifel bei gleichem
Zeitpunkt MUST der Eintrag erscheinen (eher ein Eintrag zu viel als einer zu wenig).

#### Scenario: Export nach der Erfassung

- **WHEN** Person R-007 um 09:00 erfasst und die Liste um 10:00 exportiert wurde
- **THEN** zeigt die Einsicht je Person von R-007 den Eintrag „Liste exportiert“ (10:00)

#### Scenario: Druck vor der Erfassung

- **WHEN** die Liste um 08:00 gedruckt und Person R-007 um 09:00 erfasst wurde
- **THEN** zeigt die Einsicht je Person von R-007 diesen Druck nicht

#### Scenario: Export nach der Stornierung

- **WHEN** Person R-007 um 09:30 storniert und die Liste um 10:00 exportiert wurde
- **THEN** zeigt die Einsicht je Person von R-007 diesen Export nicht

#### Scenario: Gleicher Zeitpunkt

- **WHEN** der Export in derselben Sekunde protokolliert wurde, in der Person R-007 erfasst wurde
- **THEN** zeigt die Einsicht je Person von R-007 den Export
