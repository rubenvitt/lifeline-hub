## ADDED Requirements

### Requirement: Über eine Direktkopplung kennen beide Seiten die Schlüssel der Org

Über eine Direktkopplung SHALL jede Seite der anderen die gültigen Unterschriftsschlüssel der
zugeordneten Org liefern, die sie selbst als gültig führt: die hier registrierten und die von
einem Gegenüber übernommenen, nicht aber die, die sie über genau diese Kopplung bekommen hat, und
nicht die eines ELW, der sich bei ihr über eine Standardkopplung meldet. Was die ausstellende
Seite beim Koppeln schickt und was die meldende Seite bis zu dem Stand schickt, den sie mit ihrer
ersten Meldung nennt, auch einer ohne Schlüssel, MUST als Grundstock sofort gelten. Spätere
Neuzugänge MUST in beide Richtungen ohne Prüfung einer Gegenzeichnung auf die Bestätigung eines
Admins warten: Weitergereichte Schlüssel tragen nicht immer eine, und die meldende Seite zeichnet
ihre Schlüssel nicht gegen. Widerrufe MUST sie ebenso nachliefern. Felder über den Grenzen beim
Registrieren MUST die empfangende Seite ablehnen.

#### Scenario: Schlüssel des Hubs erreicht ELW 2 über ELW 1
- **WHEN** ELW 1 vom Hub den gültigen Schlüssel von Admin A kennt und ELW 2 nur über eine Direktkopplung mit ELW 1 gekoppelt ist
- **THEN** führt ELW 2 nach dem Koppeln den Schlüssel von Admin A als gültig, und eine Notübernahme, die Admin A an ELW 1 unterschreibt, erkennt ELW 2 als bewiesen an

#### Scenario: Schlüssel der meldenden Seite erreicht die erreichte Seite
- **WHEN** an ELW 2 Admin B schon vor dem Koppeln einen Schlüssel registriert hat und ELW 2 dann den Code von ELW 1 einlöst
- **THEN** führt ELW 1 nach der ersten Meldung von ELW 2 den Schlüssel von B als gültig

#### Scenario: Neuer Schlüssel an der meldenden Seite später
- **WHEN** nach der ersten Meldung an ELW 2 Admin C einen Schlüssel registriert und ELW 2 sich bei ELW 1 meldet
- **THEN** führt ELW 1 den Schlüssel von C als „wartet auf Bestätigung“

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

Widerruft eine Instanz einen Schlüssel selbst oder erfährt sie den Widerruf von dem Gegenüber, über
das der Schlüssel hier gültig war, MUST sie jede übernommene Zeile mit derselben Credential-ID in
dieser Org als widerrufen führen; maßgeblich ist die Credential-ID der hier gespeicherten Zeile.
Ein widerrufener oder hier zurückgewiesener Schlüssel MUST NOT über eine andere Kopplung wieder
gültig werden. Das Ende einer Org-Zuordnung widerruft deren Schlüssel nur für diese Zuordnung; ein
späteres Koppeln nimmt sie wieder an. Eine Lieferung, die eine hier schon vergebene Credential-ID
mit einem anderen Schlüssel nennt, MUST abgelehnt werden.

#### Scenario: Widerruf am Hub, Schlüssel auch vor Ort bekannt
- **WHEN** ELW 1 den Schlüssel von Admin A vom Hub und zusätzlich über die Direktkopplung von ELW 2 kennt und der Hub ihn widerruft
- **THEN** führt ELW 1 nach der nächsten Meldung beim Hub beide Zeilen als widerrufen und erkennt keine Unterschrift mit diesem Schlüssel mehr an
