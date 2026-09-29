# Spec Delta

## Purpose

Legt fest, wie aus einem stabilen Release installierbare Desktop-Pakete (macOS, Windows) und ein
Update-Manifest entstehen. Außerdem, wie eine installierte Desktop-Hülle das nächste stabile
Release findet, seine Signatur prüft und es erst nach Zustimmung installiert.

## ADDED Requirements

### Requirement: Ein stabiles Release liefert Desktop-Pakete und ein Update-Manifest
Zu jedem stabilen Release, also einem Tag ohne Vorabkennung wie `v1.2.0`, MUST die
Release-Pipeline mindestens einen Installer für macOS arm64 und einen für Windows x64 ans Release
hängen. Dazu gehören die signierten Update-Archive und eine Manifestdatei `latest.json`. Die
Manifestdatei MUST je Plattform nur Einträge führen, deren Archiv und Signatur am selben Release
hängen. Die Paketversion MUST gleich der Release-Version sein.

#### Scenario: Stabiles Release
- **WHEN** das Release `v1.2.0` veröffentlicht wird
- **THEN** hängen am Release ein macOS-Paket, ein Windows-Installer, die Update-Archive mit Signaturen und `latest.json` mit der Version `1.2.0`

#### Scenario: Eine Plattform scheitert
- **WHEN** der Windows-Build eines stabilen Releases scheitert und der macOS-Build gelingt
- **THEN** führt `latest.json`, wenn es veröffentlicht wird, keinen Windows-Eintrag

### Requirement: Vorabversionen liefern keine Desktop-Pakete aus
Ein Vorab-Release (`-alpha.N`, `-beta.N`) MUST ohne ausdrückliche Anforderung keine Desktop-Pakete
und kein `latest.json` erzeugen. Ein manueller Nachbau eines Releases MUST den Desktop-Bau auf
ausdrückliche Anforderung auch für eine Vorabversion ausführen können, damit er ohne ein
stabiles Release prüfbar ist.

#### Scenario: Alpha-Release
- **WHEN** `v1.3.0-alpha.4` veröffentlicht wird
- **THEN** entstehen die Server-Binaries wie bisher, aber keine Desktop-Pakete

### Requirement: Die Hülle findet Updates nur im stabilen Kanal
Die Hülle MUST das Update-Manifest ausschließlich vom jeweils neuesten stabilen Release beziehen.
Eine installierte Vorab- oder Testversion MUST dabei keinen eigenen Kanal kennen.

#### Scenario: Neues stabiles Release
- **WHEN** die Hülle `1.2.0` startet und `1.3.0` das neueste stabile Release ist
- **THEN** bietet sie das Update auf `1.3.0` an

#### Scenario: Neuere Vorabversion
- **WHEN** die Hülle `1.2.0` startet und neben `1.2.0` als neuestem stabilem Release die Vorabversion `1.3.0-alpha.2` existiert
- **THEN** bietet sie kein Update an

### Requirement: Ein Update wird nur nach Zustimmung und mit gültiger Signatur installiert
Findet die Hülle eine neuere Version, MUST sie die Versionsnummer nennen und vor dem Laden
zustimmen lassen. Ein geladenes Update MUST sie erst nach einer zweiten Zustimmung zum Neustart
installieren, damit zwischenzeitlich Getipptes nicht unangekündigt verloren geht. Bei Ablehnung
MUST sie ohne Neustart weiterlaufen. Ein Update, dessen Signatur
nicht zum im Paket hinterlegten öffentlichen Schlüssel passt, MUST NOT installiert werden.

#### Scenario: Update abgelehnt
- **WHEN** die Hülle das Update auf `1.3.0` anbietet und jemand „Später“ wählt
- **THEN** bleibt die geladene Anwendung ohne Unterbrechung bedienbar

#### Scenario: Update angenommen
- **WHEN** jemand dem Laden von `1.3.0` und danach dem Neustart zustimmt
- **THEN** installiert die Hülle `1.3.0` und startet danach als `1.3.0` neu

#### Scenario: Geladen, Neustart verschoben
- **WHEN** jemand das Update lädt und den Neustart mit „Später“ ablehnt
- **THEN** läuft die Hülle ohne Neustart in der bisherigen Version weiter

#### Scenario: Manipuliertes Archiv
- **WHEN** das heruntergeladene Update-Archiv nicht zur Signatur im Manifest passt
- **THEN** installiert die Hülle nichts und läuft in der bisherigen Version weiter

### Requirement: Die Update-Prüfung hält den Start nicht auf
Die Hülle MUST die Anwendung laden, ohne auf die Update-Prüfung zu warten. Ist die Prüfung nicht
erreichbar, etwa ohne Internet im Einsatz, MUST sie still ausbleiben und MUST NOT eine
Fehlermeldung zeigen.

#### Scenario: Start ohne Internet
- **WHEN** die Hülle im Einsatz-LAN ohne Internetzugang startet
- **THEN** lädt sie den Einsatzserver wie sonst und zeigt keinen Update-Fehler
