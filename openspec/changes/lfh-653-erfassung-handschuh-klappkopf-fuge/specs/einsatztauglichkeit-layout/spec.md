## ADDED Requirements

### Requirement: Klappkopf folgt der Dichtestufe

Jeder Klappkopf eines aufklappbaren Abschnitts („Weitere Angaben“ in Erfassungsmasken und
jede andere Stelle der App) SHALL in jeder Dichtestufe mindestens die Steuerhöhe der Stufe
erreichen (30 / 48 / 72 px). Seine Beschriftung MUST senkrecht mittig im Kopf stehen. Ein
Kopf, der schon höher ist als der Boden, MUST NOT gekürzt werden.

#### Scenario: Handschuh-Betrieb im Ablegen-Dialog
- **WHEN** die Dichtestufe `handschuh` gewählt ist und der Dialog „Dokument ablegen“ offen ist
- **THEN** misst der Klappkopf „Bezug (optional)“ mindestens 72 px in der Höhe

#### Scenario: Touch-Betrieb
- **WHEN** derselbe Dialog in der Stufe `komfortabel` steht
- **THEN** misst der Klappkopf mindestens 48 px

#### Scenario: Kompakt wird nicht gekürzt
- **WHEN** derselbe Dialog in der Stufe `kompakt` steht
- **THEN** misst der Klappkopf mindestens 30 px und ist nicht niedriger als vor dieser Änderung

### Requirement: Abstand zwischen den Knöpfen eines Dialogfußes

In der Fußzeile einer Erfassungsmaske und in jeder Rückfrage (Dialog mit Standardfuß,
Bestätigungsdialog, Bestätigungsblase) SHALL zwischen zwei benachbarten Knöpfen in der
Dichtestufe `komfortabel` mindestens 8 px und in `handschuh` mindestens 16 px Abstand liegen.
Jeder dieser Knöpfe MUST weiterhin mindestens `controlHeightSM` der Stufe erreichen
(24 / 48 / 72 px).

#### Scenario: Erfassungsfuß im Handschuh-Betrieb
- **WHEN** die Dichtestufe `handschuh` gewählt ist und der Dialog „Dokument ablegen“ offen ist
- **THEN** liegen zwischen „Abbrechen“ und „Ablegen“ mindestens 16 px, und beide Knöpfe sind mindestens 72 px hoch

#### Scenario: Bestätigungsblase im Handschuh-Betrieb
- **WHEN** in `handschuh` die Rückfrage zum Entfernen eines Dokuments offen ist
- **THEN** liegen zwischen ihrem Abbrechen-Knopf und dem roten Bestätigungsknopf mindestens 16 px

#### Scenario: Touch-Betrieb
- **WHEN** dieselben Füße in der Stufe `komfortabel` stehen
- **THEN** beträgt der Abstand zwischen den Knöpfen mindestens 8 px

#### Scenario: Dialog mit Standardfuß
- **WHEN** ein Dialog mit dem Standardfuß (Abbrechen und Bestätigen) in `handschuh` geöffnet wird
- **THEN** liegen zwischen beiden Knöpfen mindestens 16 px, und der Abstand zwischen Titel und Inhalt des Dialogs ist derselbe wie vor dieser Änderung
