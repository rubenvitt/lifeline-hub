# bedien-wortlaut Specification

## Purpose
Legt fest, wie Knöpfe, Rückfragen und Erklärungen in der Oberfläche formuliert sind: ein Knopf
nennt seine Handlung, ein Zustand steht nur auf dem Etikett, und eine fachliche Unterscheidung ist
ohne Hover lesbar, damit Gelegenheitsnutzer am Führungs-Tablet und Handy richtig bedienen.
Herleitung: `openspec/changes/archive/2026-10-06-lfh-959-knoepfe-nennen-handlung/design.md`;
Einsatzabschluss und Rückfrage-Guard: `openspec/changes/archive/2026-10-07-lfh-960-unumkehrbares-absetzen/design.md`.

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

### Requirement: Meldung und Lage heißen überall gleich

Die Übernahme einer Meldung in die Lage SHALL an jeder Stelle „In die Lage übernehmen“ heißen
(Aktion der Meldung, Titel des Dialogs) und nach dem Speichern „In die Lage übernommen“
(Rückmeldung, Hinweis, ETB-Eintrag); eine Meldung in der Lage SHALL das Etikett „In der Lage ✓“
tragen. Das Wort „übergeben“ MUST NOT für diesen Vorgang stehen. Der ETB-Typ „Lage“ SHALL in der
Mehrzahl „Lagefeststellungen“ heißen und MUST NOT „Lagemeldungen“ heißen; „Lagemeldungen“ ist nur
das Modul. Das Paneel des Lagebilds mit den jüngsten ETB-Einträgen SHALL „Jüngste ETB-Einträge“
heißen, nicht „Meldungsstrom“.

#### Scenario: Rückmeldung in die Lage übernehmen

- **WHEN** eine Person an einer Rückmeldung „In die Lage übernehmen“ wählt und im Dialog „In die Lage übernehmen“ „Übernehmen“ bestätigt
- **THEN** meldet die App „In die Lage übernommen“, die Karte trägt „In der Lage ✓“, und keine dieser Stellen nennt „übergeben“

#### Scenario: Schnellknopf im Meldungsformular

- **WHEN** eine Person im Meldungsformular „Lagemeldung an übergeordnete Stelle“ wählt
- **THEN** stehen Art „Lagemeldung“ und Richtung „Extern“ im Formular

#### Scenario: Bilanz des ETB

- **WHEN** das ETB zwei Einträge vom Typ „Lage“ zählt
- **THEN** heißen sie in Bilanz und Lageentwicklung „Lagefeststellungen“, nicht „Lagemeldungen“

#### Scenario: Paneel im Lagebild

- **WHEN** eine Person das Lagebild öffnet
- **THEN** heißt das Paneel mit den jüngsten Einträgen des Einsatztagebuchs „Jüngste ETB-Einträge“, und die Zeile unter „Lagebild“ im Menü lautet „Lage in Zahlen, jüngste ETB-Einträge“

### Requirement: Unumkehrbares für den ganzen Einsatz steht nicht auf einer Arbeitsseite

Eine unumkehrbare Aktion, die den ganzen Einsatz betrifft, MUST NOT im Kopf oder in einem Menü
einer Arbeitsseite stehen. Der Einsatzabschluss SHALL auf den Einsatzdaten in einem eigenen
Abschnitt stehen, nur für die Einsatzleitung eines aktiven Einsatzes, und seine Rückfrage SHALL
mit „Einsatz endgültig abschließen“ bestätigen.

#### Scenario: Einsatzleitung im Einsatztagebuch

- **WHEN** die Einsatzleitung das Einsatztagebuch bei 390, 820, 1180 oder 1440 px öffnet
- **THEN** stehen weder im Kopf noch im Menü „Weitere“ ein „Einsatz abschließen“

#### Scenario: Einsatzleitung auf den Einsatzdaten

- **WHEN** die Einsatzleitung eines aktiven Einsatzes die Einsatzdaten öffnet und „Einsatz
  abschließen“ wählt
- **THEN** fragt eine Rückfrage nach, deren roter Bestätigungsknopf „Einsatz endgültig
  abschließen“ heißt, und erst diese schließt den Einsatz ab

#### Scenario: Ohne Leitungsrecht

- **WHEN** Führungspersonal oder ein Beobachter die Einsatzdaten öffnet
- **THEN** fehlt der Abschnitt „Einsatzabschluss“

### Requirement: Rote Rückfragen werden geprüft

Jede `<Popconfirm>`-Rückfrage mit rotem Bestätigungsknopf MUST einen eigenen Bestätigungstext
tragen, der nicht „Ja“ oder „OK“ lautet. Ein Guard MUST das für alle Quelldateien des Frontends
prüfen; bekannte Altstellen MAY in einer Schuldliste stehen, die nur schrumpfen darf.

#### Scenario: Neue Rückfrage ohne Handlungstext

- **WHEN** eine Datei eine `<Popconfirm>` mit `okButtonProps={{ danger: true }}` ohne `okText`
  oder mit `okText="Ja"` erhält
- **THEN** ist der Guard rot

#### Scenario: Altstelle umgestellt

- **WHEN** eine Datei der Schuldliste keine solche Rückfrage mehr trägt
- **THEN** ist der Guard rot, bis die Schuld aus der Liste gestrichen ist

#### Scenario: Bereitstellungsraum stornieren

- **WHEN** ein geplanter Bereitstellungsraum storniert werden soll
- **THEN** heißt der rote Bestätigungsknopf „BR stornieren“, und „Stornieren“ steht mit
  `size="middle"` neben „In Betrieb nehmen“
