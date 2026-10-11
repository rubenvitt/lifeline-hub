# Spec Delta

## Purpose

Hält pro Server-Instanz fest, welche Version zuletzt gestartet wurde und welche Neuigkeiten bereits
als gelesen gelten. Daraus erkennt das System beim Start einen Versionswechsel, damit die Oberfläche
die Änderungen seit der vorherigen Version anbieten kann.

## ADDED Requirements

### Requirement: Der Server merkt sich die laufende Version

Der Server SHALL beim Start die eigene Version in einem Versionsstand der Instanz festhalten. Der
Versionsstand SHALL genau eine Zeile je Instanz haben. Eine bereits vorhandene Zeile MUST beim
Start aktualisiert und NICHT neu angelegt werden.

#### Scenario: Erster Start nach der Einführung

- **WHEN** der Server zum ersten Mal mit dieser Funktion startet und noch kein Versionsstand existiert
- **THEN** legt er den Versionsstand mit der laufenden Version an
- **AND** es gilt kein Versionswechsel, also erscheint keine Hinweiskarte

#### Scenario: Gleiche Version nach einem Neustart

- **WHEN** der Server mit derselben Version neu startet
- **THEN** bleibt der Versionsstand unverändert
- **AND** es gilt kein Versionswechsel

### Requirement: Versionswechsel wird beim Start erkannt

Der Server SHALL beim Start die laufende Version mit der zuletzt gestarteten vergleichen. Weicht
sie ab, MUST er die bisherige Version als `zuletzt_gestartet` merken und die neue als laufend. Der
Lesestand bleibt dabei unverändert, damit ein ungelesener Hinweis bestehen bleibt.

#### Scenario: Update auf eine neue Alpha-Version

- **GIVEN** der Versionsstand trägt `1.0.0-alpha.100` als laufend
- **WHEN** der Server mit `1.0.0-alpha.106` startet
- **THEN** ist `1.0.0-alpha.100` die zuletzt gestartete Version
- **AND** `1.0.0-alpha.106` ist die laufende Version
- **AND** es gilt ein Versionswechsel

#### Scenario: Wechsel in einen anderen Kanal

- **GIVEN** der Versionsstand trägt `1.0.0-alpha.106` als laufend
- **WHEN** der Server mit `1.0.0` startet
- **THEN** ist `1.0.0-alpha.106` die zuletzt gestartete Version
- **AND** es gilt ein Versionswechsel über den Kanal hinweg

### Requirement: Der Lesestand ist eine Version je Instanz

Der Versionsstand SHALL die Version führen, bis zu der die Neuigkeiten als gelesen gelten
(`gelesen_bis`). Der Server MUST `gelesen_bis` auf die laufende Version setzen, sobald eine
angemeldete Person die Neuigkeiten-Seite öffnet oder die Hinweiskarte schließt, sofern die App die
Notizen der laufenden Version kennt (Spec `neuigkeiten`). Der Lesestand gilt für alle Personen
derselben Instanz.

#### Scenario: Seite geöffnet

- **GIVEN** `gelesen_bis` ist `1.0.0-alpha.100` und die laufende Version ist `1.0.0-alpha.106`
- **WHEN** eine angemeldete Person die Neuigkeiten-Seite öffnet
- **THEN** ist `gelesen_bis` gleich `1.0.0-alpha.106`

#### Scenario: Karte geschlossen

- **GIVEN** `gelesen_bis` ist `1.0.0-alpha.100` und die laufende Version ist `1.0.0-alpha.106`
- **WHEN** eine angemeldete Person die Hinweiskarte schließt
- **THEN** ist `gelesen_bis` gleich `1.0.0-alpha.106`

#### Scenario: Wer nicht angemeldet ist, ändert nichts

- **WHEN** eine nicht angemeldete Anfrage den Lesestand setzen will
- **THEN** lehnt der Server sie ab und ändert `gelesen_bis` nicht

### Requirement: Versionsstand nach außen lesbar

Der Server SHALL für angemeldete Personen die laufende Version, die zuletzt gestartete Version und
`gelesen_bis` liefern. Diese Angaben MUST auch dann verfügbar sein, wenn der Hinweis nicht
angezeigt wird.

#### Scenario: Abfrage nach einem Versionswechsel

- **GIVEN** die laufende Version ist `1.0.0-alpha.106`, die zuletzt gestartete ist `1.0.0-alpha.100`, und `gelesen_bis` ist `1.0.0-alpha.100`
- **WHEN** eine angemeldete Person den Versionsstand abfragt
- **THEN** erhält sie alle drei Angaben
