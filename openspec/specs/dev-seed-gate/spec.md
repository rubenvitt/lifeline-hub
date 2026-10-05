# dev-seed-gate Specification

## Purpose
Stellt sicher, dass der Code hinter dem Cargo-Feature `dev-seeds` (Dev-Seed, Dev-Endpunkt,
Dev-Zweige des Backend-Binaries) mit jedem Merge baut und seine Tests besteht, damit
`cargo run --features dev-seeds` nicht erst beim nächsten Entwickler bricht.

## Requirements

### Requirement: Sammel-Gate baut und testet den Dev-Seed
Der volle Lauf des Sammel-Gates MUST das Backend mit dem Feature `dev-seeds` bauen, und zwar
die Bibliothek, das Backend-Binary und den Integrationstest des Dev-Endpunkts. Er MUST die Tests
des Dev-Seeds in der Bibliothek, die Tests des Dev-Endpunkts und die Tests des Binaries mit dem
Feature ausführen. Ein Fehler beim Bauen oder ein roter Test MUST den Lauf rot machen.

#### Scenario: Gebrochener Seed-Test
- **WHEN** ein Test des Dev-Seeds in der Bibliothek fehlschlägt
- **THEN** ist der Schritt rot und der Gesamtlauf endet mit einem Exit-Code ungleich 0

#### Scenario: Seed baut nicht mehr
- **WHEN** der Dev-Seed eine Repository-Funktion mit einer veralteten Signatur aufruft
- **THEN** ist der Schritt rot, obwohl die Rust-Suite ohne Feature grün ist

#### Scenario: Dev-Endpunkt fehlt im Feature-Build
- **WHEN** `/api/dev/users` im Build mit `dev-seeds` nicht mehr registriert ist
- **THEN** ist der Schritt rot

#### Scenario: Dev-Zweig des Binaries baut nicht
- **WHEN** ein nur mit `dev-seeds` übersetzter Zweig des Backend-Binaries nicht mehr baut
- **THEN** ist der Schritt rot

### Requirement: Der Schritt läuft in der CI ohne eigenen Job
Der Schritt MUST einem Bündel des Sammel-Gates angehören, das ein bestehender CI-Job fährt, so
dass ein roter Schritt den Pull Request über einen schon bestehenden Pflicht-Check sperrt. Er
MUST NOT einen zweiten vollen Testlauf des Workspace starten.

#### Scenario: Bündelauswahl der CI
- **WHEN** die CI das Sammel-Gate mit `--nur rust` aufruft
- **THEN** läuft der Dev-Seed-Schritt in diesem Aufruf mit

#### Scenario: Selbstprüfung der Bündel
- **WHEN** der Schritt keinem Bündel zugeordnet ist
- **THEN** bricht das Sammel-Gate vor dem ersten Schritt mit einem Fehler ab

### Requirement: Der Schritt hinterlässt kein Dev-Binary
Nach dem Dev-Seed-Schritt MUST das Backend-Binary, das die Browsertests des Sammel-Gates
starten, ohne das Feature `dev-seeds` gebaut sein, gleich ob der Schritt grün oder rot endet.
Ein Filter, der keinen Test des Dev-Seeds trifft, MUST den Schritt rot machen.

#### Scenario: Browsertests nach dem Rust-Bündel
- **WHEN** nach `--nur rust` die Browsertests laufen
- **THEN** starten sie ein Backend ohne Dev-Seed, und der Admin meldet sich mit dem Passwort an,
  das die Suite vorgibt

#### Scenario: Dev-Seed verschoben
- **WHEN** die Tests des Dev-Seeds nicht mehr unter `dev::` liegen
- **THEN** ist der Schritt rot und nennt den Filter
