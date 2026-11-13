## ADDED Requirements

### Requirement: Über eine Direktkopplung kennen beide Seiten die Schlüssel der Org

Über eine Direktkopplung SHALL jede Seite der anderen die gültigen Unterschriftsschlüssel der
zugeordneten Org liefern, die sie selbst als gültig führt: die hier registrierten und die von
einem Gegenüber übernommenen, nicht aber die, die sie über genau diese Kopplung bekommen hat. Was
eine Seite beim Koppeln und mit ihrer ersten Lieferung über die Direktkopplung schickt, MUST als
Grundstock sofort gelten; spätere Neuzugänge MUST wie jede Nachlieferung eine Gegenzeichnung eines
hier gültigen Schlüssels tragen und auf die Bestätigung eines Admins warten. Widerrufe MUST sie
ebenso nachliefern.

#### Scenario: Schlüssel des Hubs erreicht ELW 2 über ELW 1
- **WHEN** ELW 1 vom Hub den gültigen Schlüssel von Admin A kennt und ELW 2 nur über eine Direktkopplung mit ELW 1 gekoppelt ist
- **THEN** führt ELW 2 nach dem Koppeln den Schlüssel von Admin A als gültig, und eine Notübernahme, die Admin A an ELW 1 unterschreibt, erkennt ELW 2 als bewiesen an

#### Scenario: Schlüssel der meldenden Seite erreicht die erreichte Seite
- **WHEN** ELW 2 den Code von ELW 1 eingelöst hat und an ELW 2 Admin B einen Schlüssel registriert hat, den ELW 1 noch nicht kennt
- **THEN** führt ELW 1 nach der ersten Meldung von ELW 2 den Schlüssel von B als gültig

#### Scenario: Neuer Schlüssel des Hubs später
- **WHEN** nach dem Koppeln am Hub der Schlüssel von Admin C gegengezeichnet wird und ELW 1 ihn als gültig bestätigt hat
- **THEN** liefert ELW 1 ihn an ELW 2, und dort wartet er auf die Bestätigung eines Admins

### Requirement: Der ELW liefert seine Schlüssel dem Hub zur Bestätigung

Über eine Standardkopplung SHALL die meldende Seite der erreichten Seite die Unterschriftsschlüssel
liefern, die bei ihr registriert sind, samt Widerrufen. Die erreichte Seite MUST jeden davon ohne
Gegenzeichnung als „wartet auf Bestätigung“ führen, auch den ersten; erst die Bestätigung eines
Admins dort mit den letzten vier Zeichen des Fingerabdrucks macht ihn gültig. Die erreichte Seite
MUST solche Schlüssel nicht weiterliefern.

#### Scenario: Schlüssel eines ELW-Admins am Hub
- **WHEN** Admin B an ELW 2 einen Unterschriftsschlüssel registriert und ELW 2 sich beim Hub meldet
- **THEN** zeigt der Hub den Schlüssel von B als „wartet auf Bestätigung“, und erst nach der Bestätigung dort erkennt der Hub eine Unterschrift von B an

#### Scenario: Widerruf am ELW
- **WHEN** der Schlüssel von B am Hub gilt und ELW 2 ihn widerruft
- **THEN** führt der Hub ihn nach der nächsten Meldung von ELW 2 als widerrufen

### Requirement: Ein Widerruf gilt für den Schlüssel, nicht für die Lieferung

Erfährt eine Instanz, dass ein Unterschriftsschlüssel widerrufen ist, egal über welche Kopplung oder
ob hier, MUST sie jede Zeile mit derselben Credential-ID in dieser Org als widerrufen führen.
Ein widerrufener Schlüssel MUST NOT über eine andere Kopplung wieder gültig werden.

#### Scenario: Widerruf am Hub, Schlüssel auch vor Ort bekannt
- **WHEN** ELW 1 den Schlüssel von Admin A vom Hub und zusätzlich über die Direktkopplung von ELW 2 kennt und der Hub ihn widerruft
- **THEN** führt ELW 1 nach der nächsten Meldung beim Hub beide Zeilen als widerrufen und erkennt keine Unterschrift mit diesem Schlüssel mehr an
