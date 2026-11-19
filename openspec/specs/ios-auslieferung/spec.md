# ios-auslieferung Specification

## Purpose
Wie die iOS-App geprüft, versioniert und an Testerinnen und Tester verteilt wird: Prüfung des
Swift-Kerns und des App-Baus in der CI, eine Versionsquelle mit dem Server und Verteilung über
TestFlight an den Kanälen `beta` und `main`.

## Requirements

### Requirement: Die Version der App kommt aus dem Workspace
Die App MUST ihre Version aus `[workspace.package]` der Wurzel beziehen. Die Marketing-Version
MUST die Workspace-Version ohne Vorab-Suffix sein, die volle Workspace-Version MUST in der App
lesbar sein und in der Kennung `version` erscheinen. Die Build-Nummer MUST bei jedem Upload größer
sein als bei jedem früheren Upload. `ios/` MUST keine eigene Versionsangabe pflegen.

#### Scenario: Beta-Tag
- **WHEN** der Tag `v1.0.0-beta.3` gebaut wird
- **THEN** trägt die App die Marketing-Version `1.0.0` und meldet `version` `1.0.0-beta.3`

### Requirement: Der Swift-Kern wird mit den Suiten geprüft
Die Logik ohne Oberfläche (Adressprüfung, Deeplink, Linkregeln, Serverliste, Vertragsprüfung)
MUST in einem Schritt von `scripts/check-all.sh` geprüft werden, der auch unter Linux läuft. Fehlt
lokal die Swift-Toolchain, MUST der Schritt als Lücke gemeldet werden; in der CI MUST er sie
verlangen. Die gemeinsamen Fälle mit der Desktop-Hülle MUST in beiden Hüllen geprüft werden.

#### Scenario: Geänderte Adressregel
- **WHEN** jemand einen Fall der gemeinsamen Adressprüfung ändert
- **THEN** prüfen die Suiten der Desktop-Hülle und des Swift-Kerns ihn beide

### Requirement: Ein PR mit iOS-Änderungen baut die App im Simulator
Ändert ein PR Dateien unter `ios/` oder die gemeinsamen Fälle, MUST ein Lauf auf einem
macOS-Runner das Projekt erzeugen, die App für den Simulator bauen, die Swift-Tests auf iOS
ausführen und Bildschirmbilder der nativen Seiten als Artefakt ablegen. Dieser Lauf MUST NOT ein
Pflicht-Check für PRs ohne solche Änderungen sein.

#### Scenario: PR ohne iOS-Änderung
- **WHEN** ein PR nur das Frontend ändert
- **THEN** startet kein macOS-Lauf für die App

### Requirement: TestFlight erhält Beta- und stabile Stände
Nach einer grünen Freigabe eines Tags der Kanäle `beta` oder `main` MUST die App archiviert,
signiert und zu TestFlight hochgeladen werden; zusätzlich MUST ein Handstart möglich sein.
Alpha-Tags MUST NOT hochgeladen werden. Ein gescheiterter Upload MUST das Release des Servers
nicht aufhalten.

#### Scenario: Alpha-Tag
- **WHEN** ein Tag `v1.0.0-alpha.200` freigegeben wird
- **THEN** entsteht kein TestFlight-Build

#### Scenario: Upload scheitert
- **WHEN** der Upload zu TestFlight an einem Beta-Tag scheitert
- **THEN** ist das Server-Release trotzdem veröffentlicht, und der Fehler ist im Lauf sichtbar
