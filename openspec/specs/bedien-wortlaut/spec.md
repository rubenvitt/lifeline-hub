# bedien-wortlaut Specification

## Purpose
Legt fest, wie Knöpfe, Rückfragen und Erklärungen in der Oberfläche formuliert sind: ein Knopf
nennt seine Handlung, ein Zustand steht nur auf dem Etikett, und eine fachliche Unterscheidung ist
ohne Hover lesbar, damit Gelegenheitsnutzer am Führungs-Tablet und Handy richtig bedienen.
Herleitung: `openspec/changes/archive/2026-10-06-lfh-959-knoepfe-nennen-handlung/design.md`.

## Requirements

### Requirement: Knöpfe nennen ihre Handlung

Ein Knopf SHALL eine Handlung tragen („Bearbeitung beginnen“, „Außer Dienst nehmen“), ein Zustand
SHALL nur auf einem Etikett stehen. Kein Knopftext MUST einem Statuswort desselben Moduls gleichen.
Für Meldungen, Aufträge, Nachforderungen und den Dienststatus der Stammdaten MUST ein Guard das
prüfen.

#### Scenario: Auftrag im Zustand „Offen“

- **WHEN** eine Führungskraft einen offenen Auftrag sieht
- **THEN** steht neben dem Etikett „Offen“ der Knopf „Bearbeitung beginnen“, nicht „In Bearbeitung“

#### Scenario: Nachforderung fortschalten

- **WHEN** eine angeforderte Nachforderung fortgeschaltet werden kann
- **THEN** heißt der Knopf „Zusage erfassen“, nicht „→ Zugesagt“

#### Scenario: Statuswort im Knopf

- **WHEN** ein Knopf eines dieser Module ein Statuswort desselben Moduls trägt
- **THEN** ist der Guard rot

### Requirement: Rückfragen nennen die Handlung

Der Bestätigungsknopf einer Rückfrage SHALL die Handlung nennen („Einsatz endgültig
abschließen“). Er MUST NOT nur „Ja“ oder „OK“ lauten.

#### Scenario: Rückfrage vor einer Kenntnisnahme

- **WHEN** eine Sofortmeldung bestätigt wird
- **THEN** heißt der Bestätigungsknopf der Rückfrage „Bestätigen“, nicht „OK“

### Requirement: Kein Tooltip als einzige Erklärung

Eine fachliche Unterscheidung MUST ohne Hover lesbar sein. Ein Tooltip MAY ergänzen, er MUST NOT
die einzige Erklärung sein.

#### Scenario: Erinnerung am Tablet

- **WHEN** eine fällige Erinnerung am Tablet hoch (820 px) oder Handy (390 px) steht
- **THEN** heißen die Knöpfe „Erübrigt (zur Kenntnis)“ und „Erledigt (durchgeführt)“, und die Karte
  trägt keinen Tooltip, ohne den der Unterschied verloren ginge

### Requirement: Quittieren heißt Empfang bestätigt

„Quittieren“ und „quittiert“ SHALL in der Oberfläche nur für die Bestätigung von Empfang oder
Kenntnis einer Nachricht stehen (Meldungen, Aufträge, Meldungen an der Fernmeldeskizze). Eine
Erinnerung, die sich erübrigt, MUST „erübrigt“ heißen.

#### Scenario: Erübrigte Erinnerung in der Abgeschlossen-Ansicht

- **WHEN** eine Erinnerung über „Erübrigt (zur Kenntnis)“ geschlossen wurde
- **THEN** trägt sie das Statuswort „Erübrigt“ und „Erübrigt: ‹Zeit›“, kein „Quittiert“

### Requirement: Überfällige Bestätigung heißt überall gleich

Die Meldungsseite SHALL die Zahl unbestätigter Meldungen mit verstrichener Frist „Bestätigung
überfällig“ nennen, wie Modulzähler und Lage-Dashboard. Das Wort „Alarmiert“ MUST NOT dafür
stehen.

#### Scenario: Kennzahlen der Meldungsseite

- **WHEN** eine Sofortmeldung ihre Bestätigungsfrist überschritten hat
- **THEN** zählt die Kennzahl „Bestätigung überfällig“ sie, und die Seite enthält kein „Alarmiert“
