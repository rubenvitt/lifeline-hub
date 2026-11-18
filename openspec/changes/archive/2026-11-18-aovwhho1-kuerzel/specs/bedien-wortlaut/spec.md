## ADDED Requirements

### Requirement: Kürzel sind eingeführt oder erklärt
Die Oberfläche SHALL ein Kürzel nur zeigen, wenn es eingeführt ist oder auf derselben Fläche sichtbar
erklärt wird. Eingeführt sind die Kürzel, die das Anwenderkapitel „Zeiten und Kürzel“ führt: FMS und
S1–S9, SK I–IV, ETB, UHS, BR, F/UF/M//Σ, Rückm., Einh., Fzg., Mtl., Pers. Ein neues Kürzel MUST dort
nachgetragen werden, sonst wird es ausgeschrieben. Kurzbezeichnungen, die eine Organisation selbst
vergibt („EA 1.1“), MUST unverändert stehen.

#### Scenario: Unterabschnitte im Überblick
- **WHEN** ein Abschnitt im Überblick zwei Unterabschnitte hat
- **THEN** steht „inkl. Unterabschnitte · 2 Unterabschnitte“ und nicht „UA“

#### Scenario: Lagezustand eines Unterabschnitts
- **WHEN** ein Unterabschnitt kritisch ist
- **THEN** zeigt die Abschnittskarte „Unterabschnitt kritisch“

#### Scenario: Fahrzeuge in der Verdichtungszeile
- **WHEN** die Kräfte-Seite die Verdichtungszeile mit 4 Fahrzeugen zeigt
- **THEN** steht dort „Fahrzeuge 4“

#### Scenario: Kurzbezeichnung der Organisation
- **WHEN** ein Abschnitt die Kurzbezeichnung „EA 1.1“ trägt
- **THEN** steht sie unverändert im Überblick und im Organigramm
