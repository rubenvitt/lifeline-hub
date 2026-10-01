# Spec Delta

## ADDED Requirements

### Requirement: macOS-Pakete sind mit Developer ID signiert und notarisiert
Jedes macOS-Paket, das die Release-Pipeline ans Release hängt, MUST mit dem Zertifikat
„Developer ID Application“ des Teams `H95J852PKP` signiert und von Apple notarisiert sein. Das
gilt für das `.dmg`, die App darin und die App im Update-Archiv. App und `.dmg` MUST das
Notarisierungsticket angeheftet tragen, damit Gatekeeper sie auch ohne Internet beim ersten
Start anerkennt. Kann der Lauf ein macOS-Paket nicht signieren oder nicht notarisieren, MUST
er kein macOS-Paket und keinen macOS-Eintrag in `latest.json` ausliefern. Ein nur ad hoc oder
nur signiertes Paket MUST NOT ausgeliefert werden.

#### Scenario: Stabiles Release
- **WHEN** das Release `v1.2.0` mit Desktop-Paketen veröffentlicht wird
- **THEN** sind das `.dmg` und die App darin mit „Developer ID Application: Ruben Vitt (H95J852PKP)“ signiert, notarisiert und tragen das Ticket, und die App im Update-Archiv ebenso

#### Scenario: Erster Start auf einem fremden Mac
- **WHEN** jemand das `.dmg` aus dem Release auf einem Mac lädt, der die App nie gesehen hat, die App nach „Programme“ zieht und öffnet
- **THEN** zeigt macOS höchstens die Rückfrage, dass die App aus dem Internet geladen und von Apple auf Schadsoftware geprüft wurde, und startet sie nach „Öffnen“; die Meldung „kann nicht geöffnet werden“ erscheint nicht, und der Weg über „Datenschutz & Sicherheit“ ist nicht nötig

#### Scenario: Zugangsdaten für die Notarisierung fehlen
- **WHEN** ein Release-Lauf die Desktop-Pakete baut und ein Zugangsdatum für Signierung oder Notarisierung fehlt oder Apple die Einreichung ablehnt
- **THEN** schlägt der macOS-Bau fehl, am Release hängt kein macOS-Paket, `latest.json` führt keinen macOS-Eintrag, und der Windows-Installer wird davon nicht berührt

#### Scenario: Update einer notarisierten App
- **WHEN** eine installierte, notarisierte App `1.2.0` dem Update auf `1.3.0` und dem Neustart zustimmt
- **THEN** startet sie als `1.3.0` ohne Gatekeeper-Rückfrage
