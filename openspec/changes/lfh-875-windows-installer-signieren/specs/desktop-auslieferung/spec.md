# Spec Delta

## ADDED Requirements

### Requirement: Windows-Pakete sind Authenticode-signiert
Jedes Windows-Paket, das die Release-Pipeline ans Release hängt, MUST per Authenticode mit einem
Code-Signing-Zertifikat auf den Namen „Ruben Vitt“ signiert sein, das auf eine Wurzel des
Microsoft Trusted Root Program zurückgeht. Das gilt für den Installer, die App darin und den
Deinstaller. Jede Signatur MUST einen Zeitstempel tragen. Kann der Lauf ein Windows-Paket nicht
signieren, MUST er kein Windows-Paket und keinen Windows-Eintrag in `latest.json` ausliefern.

#### Scenario: Stabiles Release
- **WHEN** das Release `v1.2.0` mit Desktop-Paketen veröffentlicht wird
- **THEN** sind der Windows-Installer, die installierte `lifeline-desktop.exe` und der Deinstaller mit dem Zertifikat „Ruben Vitt“ signiert und zeitgestempelt, und Windows meldet jede Signatur als gültig

#### Scenario: Erster Start auf einem fremden Windows-Rechner
- **WHEN** jemand den Installer aus dem Release per Browser lädt und startet
- **THEN** nennt Windows „Ruben Vitt“ als Herausgeber, auch wenn SmartScreen mangels Reputation noch nachfragt, und die Dateieigenschaften zeigen unter „Digitale Signaturen“ eine gültige Signatur mit Zeitstempel

#### Scenario: Zugangsdaten für die Signierung fehlen
- **WHEN** ein Release-Lauf die Desktop-Pakete baut und ein Zugangsdatum für die Signierung fehlt oder der Signierdienst ablehnt
- **THEN** schlägt der Windows-Bau fehl, am Release hängt kein Windows-Installer, `latest.json` führt keinen Windows-Eintrag, und das macOS-Paket wird davon nicht berührt

#### Scenario: Zertifikat abgelaufen
- **WHEN** ein signierter Installer nach Ablauf des Zertifikats gestartet wird
- **THEN** meldet Windows die Signatur weiter als gültig, weil sie vor dem Ablauf zeitgestempelt wurde

#### Scenario: Update einer signierten App
- **WHEN** eine installierte, signierte App `1.2.0` dem Update auf `1.3.0` und dem Neustart zustimmt
- **THEN** startet sie als `1.3.0`, und die neue `lifeline-desktop.exe` ist ebenso signiert
