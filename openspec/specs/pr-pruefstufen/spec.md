# pr-pruefstufen Specification

## Purpose
Legt fest, welche Prüfungen auf einem offenen Pull Request und auf den Kanal-Branches wann laufen:
im PR nur die leichten Pflicht-Checks (mit dem Label `voll` zusätzlich alle Suiten ohne Pflicht),
auf `alpha`, `beta` und `main` alle Suiten, abbrechbar durch einen neueren Push, mit einem Release
nur aus einem vollständig grünen Lauf.

## Requirements

### Requirement: Kanal-Branches prüfen immer voll
Ein Push auf `alpha`, `beta` oder `main` MUST alle Suiten einschließlich e2e voll fahren, unabhängig von Auto-Merge, Labels und geänderten Dateien. Der Release-Job MUST auf alle vier Prüfjobs (Schnellprüfungen, Rust, Frontend, e2e) dieses Laufs warten und MUST entfallen, wenn einer davon abgebrochen wurde.

#### Scenario: Merge auf alpha
- **WHEN** ein PR auf `alpha` gemergt wird
- **THEN** laufen auf dem Merge-Commit Schnellprüfungen, Rust-, Frontend- und e2e-Suite, und ein Release entsteht nur, wenn alle grün sind

### Requirement: Ein PR prüft nur leicht
Ein Push auf einen offenen Pull Request gegen `alpha`, `beta` oder `main` MUST die Schnellprüfungen starten. Ohne das Label `voll` MUST er weder die Rust-, die Frontend- noch die e2e-Suite starten. Pflicht für das Mergen MUST nur sein: `Schnellprüfungen`, `Migrationsnummern` und `ADR-Nummern`.

#### Scenario: PR ohne Label
- **WHEN** auf einen PR ohne Label `voll` ein Commit gepusht wird, der Backend- und Frontend-Code ändert
- **THEN** laufen die Schnellprüfungen, und kein Job fährt die Rust-, Frontend- oder e2e-Suite

#### Scenario: Mergebar ohne Suiten
- **WHEN** an einem PR mit Auto-Merge `Schnellprüfungen`, `Migrationsnummern` und `ADR-Nummern` grün sind
- **THEN** ist er mergebar, ohne dass eine schwere Suite auf ihm lief

### Requirement: Das Label `voll` fährt alle Suiten im PR
Trägt ein PR das Label `voll`, MUST jeder Push auf ihn und das Setzen des Labels die Rust-, Frontend- und e2e-Suite ganz starten, ohne Auswahl nach geänderten Dateien. Ihre Ergebnisse MUST NOT Pflicht für das Mergen sein. An einem PR ohne `voll` MUST ein anderes Label keine schwere Suite starten und keinen laufenden Lauf abbrechen. An einem PR mit `voll` MUST jedes Ereignis die Suiten neu starten, damit kein übersprungener Check eine rote Suite verdeckt.

#### Scenario: Label gesetzt
- **WHEN** ein PR das Label `voll` bekommt
- **THEN** laufen auf seinem Kopf-Commit Schnellprüfungen, Rust-, Frontend- und e2e-Suite

#### Scenario: Rote Suite mit Label
- **WHEN** an einem PR mit Label `voll` die Frontend-Suite rot ist und die Pflicht-Checks grün sind
- **THEN** ist der PR trotzdem mergebar, und die rote Suite steht sichtbar am PR

#### Scenario: Anderes Label
- **WHEN** ein PR ohne `voll` ein anderes Label bekommt
- **THEN** startet keine schwere Suite, und ein laufender Lauf läuft weiter

#### Scenario: Anderes Label an einem PR mit `voll`
- **WHEN** ein PR mit `voll` und roter Rust-Suite ein weiteres Label bekommt
- **THEN** laufen die Suiten neu, und die Rust-Suite steht danach wieder mit echtem Ergebnis am PR, nie als übersprungen

### Requirement: Ein neuer Push auf einen Kanal-Branch bricht die Tests des laufenden Laufs ab
Ein Push auf `alpha`, `beta` oder `main` MUST die Testjobs (Rust-, Frontend-, e2e-Suite) eines noch laufenden Laufs auf demselben Branch abbrechen. Ein Release-Job, der schon läuft, MUST NOT abbrechen. Ein Release MUST nur aus einem Lauf entstehen, dessen Schnellprüfungen und Suiten alle grün sind.

#### Scenario: Zwei Merges kurz hintereinander
- **WHEN** während des Laufs zu Merge A auf `alpha` Merge B landet
- **THEN** brechen die Testjobs zu A ab, die zu B laufen voll, und ein Release kommt nur aus dem Lauf zu B

#### Scenario: Release läuft schon
- **WHEN** im Lauf zu A der Release-Job schon läuft und Merge B landet
- **THEN** läuft der Release zu A zu Ende, und der Release zu B wartet auf ihn

### Requirement: Ein PR zeigt keine Jobs der Kanal-Branches
Ein Ereignis an einem PR MUST keinen Job anlegen, der nur bei einem Push auf einen Kanal-Branch läuft, auch nicht als übersprungen. An einem PR ohne `voll` MUST aus dem PR-Workflow der Prüfungen höchstens ein übersprungener Eintrag stehen: der Aufruf der Suiten. Ein Pflicht-Check MUST unter seinem Namen ohne Präfix eines aufgerufenen Workflows erscheinen.

#### Scenario: PR ohne Label
- **WHEN** auf einen PR ohne `voll` gepusht wird
- **THEN** stehen am PR weder `Release`, `Testberichte zusammenführen` noch `Offene PRs neu bewerten`, und aus dem PR-Workflow der Prüfungen erscheint als übersprungen höchstens der Aufruf der Suiten

#### Scenario: Pflicht-Checks unverändert
- **WHEN** an einem PR alle Pflicht-Checks grün sind
- **THEN** heißen sie `Schnellprüfungen`, `Migrationsnummern` und `ADR-Nummern`

#### Scenario: Push auf alpha
- **WHEN** ein PR auf `alpha` gemergt wird
- **THEN** laufen auf dem Merge-Commit weiter Schnellprüfungen, alle Suiten, und das Neubewerten der Migrationsnummern

### Requirement: PR-Code läuft nie auf einer Kanal-Ref
Code aus einem PR MUST nie in einem Lauf ausgeführt werden, dessen Ref ein Kanal-Branch ist (`alpha`, `beta`, `main`). Ein Lauf, der nach einem Push auf einen Kanal-Branch offene PRs bewertet, MUST seine Skripte vom Kanal-Branch nehmen und MUST keinen Code aus dem PR ausführen.

#### Scenario: Offene PRs nach einem Merge bewerten
- **WHEN** nach einem Merge auf `alpha` die Migrations- und ADR-Nummern der offenen PRs neu bewertet werden
- **THEN** stammen die prüfenden Skripte von `alpha`, und kein Code aus einem PR läuft im Bereich von `alpha`
