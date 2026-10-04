# Spec Delta

## MODIFIED Requirements

### Requirement: Abgeleitet und live

Die Skizze SHALL allein aus den Abschnitten und Einheiten des Einsatzes, ihren
Sprechgruppen-Zuordnungen und der eigenen Führungsstelle entstehen, ohne eigene Speicherung. Eine
Änderung an Gliederung, Rufname, Sprechgruppen-Zuordnung oder Führungsstelle MUST ohne Neuladen der
Seite in der Skizze erscheinen.

#### Scenario: Sprechgruppe wird zugeordnet

- **WHEN** an einem anderen Arbeitsplatz einer Einheit die Sprechgruppe ihres Abschnitts
  zugeordnet wird, während die Skizze offen ist
- **THEN** trägt die Kante zwischen Abschnitt und Einheit diese Sprechgruppe ohne Neuladen, und die
  Lücke an der Kante ist verschwunden

#### Scenario: Führungsstelle wird erfasst

- **WHEN** an einem anderen Arbeitsplatz der Rufname der Führungsstelle gespeichert wird, während
  die Skizze offen ist
- **THEN** zeigt die Wurzel „Einsatzleitung“ diesen Rufnamen ohne Neuladen

### Requirement: Kante mit gemeinsamer Sprechgruppe

Die Kante zwischen einer Stelle und ihrer übergeordneten Stelle (Führungsstelle, Abschnitt oder
Einheit) SHALL die Sprechgruppen tragen, die beiden zugeordnet sind, getrennt nach TMO und DMO.
Übergeordnete Stelle eines obersten Abschnitts ist die eigene Führungsstelle an der Wurzel.
Verglichen wird die Sprechgruppe selbst, nicht ihre Bezeichnung. Kanten unter dem Sammelknoten MUST
NOT eine Sprechgruppe oder ein Urteil tragen.

#### Scenario: Gemeinsamer Kanal

- **WHEN** „EA Nord“ die Sprechgruppen „TMO 311“ und „DMO 505“ trägt und die ihm zugeordnete
  Einheit „1. Zug“ „DMO 505“
- **THEN** trägt die Kante zwischen beiden „DMO 505“ und nicht „TMO 311“

#### Scenario: Gemeinsamer Kanal mit der Führungsstelle

- **WHEN** die Führungsstelle „TMO 311“ trägt und der oberste Abschnitt „EA Nord“ „TMO 311“ und
  „DMO 505“
- **THEN** trägt die Kante zwischen Wurzel und „EA Nord“ „TMO 311“

#### Scenario: Einheit ohne Abschnitt

- **WHEN** eine Einheit keinem Abschnitt zugeordnet ist
- **THEN** steht sie unter „Ohne Abschnitt“, und ihre Kante trägt weder Sprechgruppe noch Lücke

### Requirement: Einsatzleitung ohne erfundene Gegenstelle

Ist die eigene Führungsstelle erfasst, SHALL die Wurzel „Einsatzleitung“ ihren Rufnamen, ihre TMO-
und DMO-Sprechgruppen und ihr Kommunikationsmittel zeigen, nie ihre Erreichbarkeit. Ist sie nicht
erfasst, SHALL die Wurzel „Gegenstelle nicht erfasst“ zeigen, und die Kanten der ersten Ebene
tragen kein Urteil. Die Skizze MUST NOT einen Rufnamen oder eine Sprechgruppe für die
Einsatzleitung aus anderen Daten ableiten. Eine Stabsstelle MUST NOT in der Skizze erscheinen.

#### Scenario: Wurzel

- **WHEN** die Skizze eines Einsatzes ohne erfasste Führungsstelle geöffnet wird
- **THEN** trägt die Wurzel „Einsatzleitung“ den Hinweis „Gegenstelle nicht erfasst“ und keine
  Sprechgruppe, und die Kanten der ersten Ebene tragen kein Urteil

#### Scenario: Wurzel mit erfasster Führungsstelle

- **WHEN** die Führungsstelle mit Rufname „Florian Musterstadt 10/1“, „TMO 311“ und einer
  Erreichbarkeit erfasst ist
- **THEN** zeigt die Wurzel den Rufnamen und „311“ unter TMO, und die Erreichbarkeit fehlt

### Requirement: Deeplinks statt Bearbeitung

Der Name eines Abschnittsknotens SHALL zum ausgewählten Abschnitt der Abschnittsseite führen, der
Name eines Einheitsknotens zur Detailseite der Einheit, die Wurzel „Einsatzleitung“ zur Seite
Einsatzdaten. Dort werden Rufname und Sprechgruppen gepflegt. Die Skizze MUST keine
Bearbeitungsmöglichkeit bieten.

#### Scenario: Lücke beheben

- **WHEN** die Person an einer Kante mit „keine gemeinsame Sprechgruppe“ auf den Namen der Einheit
  tippt
- **THEN** öffnet sich die Detailseite dieser Einheit

#### Scenario: Zur Führungsstelle

- **WHEN** die Person auf „Einsatzleitung“ tippt
- **THEN** öffnet sich die Seite Einsatzdaten mit dem Paneel „Eigene Führungsstelle“
