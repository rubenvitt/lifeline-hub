# Spec Delta

## MODIFIED Requirements

### Requirement: Kollidierende PRs werden automatisch umnummeriert
Wird der Status `Migrationsnummern` eines offenen PRs aus diesem Repository rot und lässt sich
der Verstoß durch Umnummerieren beheben, MUST die CI die neuen Migrationen des PRs auf die
nächsten freien Nummern über dem Ziel-Branch legen, Verweise auf die alten Dateinamen
mitziehen und das Ergebnis als eigenen Commit auf den Kopf-Branch des PRs pushen. Auf dem
neuen Kopf-Commit MUST `Migrationsnummern` und die Schnellprüfungen neu laufen. Die schweren
Suiten (Rust, Frontend, e2e) MUST dort ebenfalls laufen, außer der Kopf-Commit unterscheidet sich
vom letzten Commit mit grünen schweren Suiten nur durch Autofix-Commits, die Dateien unter
`migrations/` unverändert umbenennen und daneben höchstens Dateien ändern, die keine der
schweren Suiten liest: dann MAY ihr Ergebnis von diesem Commit übernommen werden, und die
Pflicht-Checks des PRs MUST trotzdem erfüllt sein.

#### Scenario: Kollision nach fremdem Merge
- **WHEN** PR B `0143_b.sql` mitbringt und auf `alpha` gerade PR A mit `0143_a.sql` gemergt wurde
- **THEN** trägt der Branch von B danach einen Bot-Commit, der `0143_b.sql` in `0144_b.sql` umbenennt, und auf diesem Commit laufen `Migrationsnummern` und die CI-Checks neu

#### Scenario: PR wird schon kollidierend geöffnet
- **WHEN** ein PR geöffnet wird, dessen neue Migration eine Nummer trägt, die auf dem Ziel-Branch schon vergeben ist
- **THEN** bekommt er denselben Autofix-Commit wie nach einem fremden Merge

#### Scenario: Bestandsmigration verändert
- **WHEN** ein PR eine Migration ändert, umbenennt oder löscht, die es an seiner Abzweigung schon gab
- **THEN** bleibt der Status rot und die CI pusht nichts auf den Branch

#### Scenario: Grüner PR wird nur umnummeriert
- **WHEN** alle schweren Suiten eines PRs grün waren und danach ein Autofix-Commit nur `0143_b.sql` in `0144_b.sql` umbenennt
- **THEN** laufen auf dem neuen Kopf-Commit die Schnellprüfungen und `Migrationsnummern`, die schweren Suiten laufen nicht erneut, und der PR ist mergebar, sobald die Schnellprüfungen grün sind

#### Scenario: Zwei Umnummerierungen nacheinander
- **WHEN** auf einen grünen Commit zwei Autofix-Commits folgen, die nur Migrationen umbenennen
- **THEN** laufen die schweren Suiten auf dem zweiten nicht erneut

#### Scenario: Vorgänger war nicht grün
- **WHEN** der Autofix-Commit auf einem Commit sitzt, dessen schwere Suiten noch liefen, abgebrochen wurden oder rot waren
- **THEN** laufen die schweren Suiten auf dem neuen Kopf-Commit voll

#### Scenario: Umnummerierung mit mitgezogenem Verweis im Code
- **WHEN** der Autofix-Commit neben der Umbenennung einen Verweis in einer Datei umschreibt, die eine der schweren Suiten liest
- **THEN** laufen die schweren Suiten auf dem neuen Kopf-Commit voll

#### Scenario: Umnummerierung mit mitgezogenem Verweis in der Doku
- **WHEN** der Autofix-Commit neben der Umbenennung nur einen Verweis in einer Datei umschreibt, die keine der schweren Suiten liest
- **THEN** laufen die schweren Suiten nicht erneut

#### Scenario: Fremder Commit mit Autofix-Kennzeichen
- **WHEN** ein Commit das Kennzeichen des Autofix trägt, aber eine Migration inhaltlich ändert, Code berührt oder gar keine Migration umbenennt
- **THEN** laufen die schweren Suiten voll
