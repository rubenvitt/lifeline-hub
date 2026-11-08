## MODIFIED Requirements

### Requirement: Neue Schlüssel nur mit Unterschrift eines bekannten Admins

Ein neuer Unterschriftsschlüssel SHALL erst verteilt werden, wenn ein Admin der Org ihn mit einem
schon gültigen Unterschriftsschlüssel unterschrieben hat. Die empfangende Instanz MUST einen
neuen Schlüssel nur übernehmen, wenn die Unterschrift von einem ihr bekannten, gültigen Schlüssel
derselben Org stammt; sonst MUST sie ihn verwerfen und den Vorfall anzeigen. Einen übernommenen
neuen Schlüssel MUST sie als „wartet auf Bestätigung“ führen, bis ein Admin dort ihn bestätigt.
Ein wartender Schlüssel MUST NOT als Unterschrift oder Gegenzeichnung anerkannt werden.

#### Scenario: Gegengezeichneter Schlüssel
- **WHEN** Admin B einen Schlüssel registriert, Admin A ihn mit seinem Unterschriftsschlüssel gegenzeichnet und der ELW sich meldet
- **THEN** führt der ELW den Schlüssel von B als „wartet auf Bestätigung“

#### Scenario: Wartender Schlüssel zählt nicht
- **WHEN** eine Erklärung mit dem noch wartenden Schlüssel von B gegengezeichnet am ELW ankommt
- **THEN** verwirft der ELW sie wie die Unterschrift eines unbekannten Schlüssels

#### Scenario: Hub schiebt einen fremden Schlüssel unter
- **WHEN** ein Hub einem ELW einen Schlüssel ohne gültige Gegenzeichnung eines dem ELW bekannten Schlüssels liefert
- **THEN** verwirft der ELW ihn und zeigt „ungültiger Unterschriftsschlüssel vom Gegenüber abgelehnt“ in der Kopplung und in der Admin-Spur

#### Scenario: Erster Schlüssel der Org
- **WHEN** ein Admin den ersten Unterschriftsschlüssel einer Org registriert
- **THEN** gilt er an seiner Instanz ohne Gegenzeichnung, weil noch keine Kopplung der Org besteht

### Requirement: Widerruf eines Unterschriftsschlüssels

Ein Admin SHALL eigene Unterschriftsschlüssel und die anderer Admins seiner Org widerrufen können;
wird ein Admin-Konto deaktiviert oder verliert es die Admin-Rolle, MUST das System seine
Unterschriftsschlüssel widerrufen, auch den letzten gültigen einer gekoppelten Org. Eine
gekoppelte Instanz MUST einen Widerruf vom Gegenüber ohne Gegenzeichnung und ohne Bestätigung
annehmen, auch für einen wartenden Schlüssel. Den letzten gültigen Schlüssel einer gekoppelten
Org MUST ein Admin nicht einzeln widerrufen können, solange keine Kopplung der Org widerrufen
ist. Bevor ein Deaktivieren oder Herabstufen den letzten gültigen Schlüssel widerruft, MUST die
Benutzerverwaltung davor warnen; danach MUST die Kopplung zeigen, dass die Org neu gekoppelt
werden muss.

#### Scenario: Widerruf erreicht den ELW
- **WHEN** der Hub den Schlüssel von Admin B widerruft und der ELW sich meldet
- **THEN** zeigt der ELW den Schlüssel als widerrufen und nimmt keine Unterschrift damit mehr an

#### Scenario: Letzter Schlüssel
- **WHEN** ein Admin den einzigen gültigen Unterschriftsschlüssel einer Org mit bestehender Kopplung widerrufen will
- **THEN** antwortet der Server mit 409 und nennt die Kopplungen

#### Scenario: Deaktivieren hat Vorrang
- **WHEN** ein Admin das Konto von Admin A deaktiviert, das den einzigen gültigen Schlüssel der gekoppelten Org hält
- **THEN** warnt die Benutzerverwaltung vorher, dass die Org danach neu gekoppelt werden muss
- **AND** nach dem Bestätigen ist das Konto deaktiviert, der Schlüssel widerrufen, und die Kopplung zeigt „Kein gültiger Unterschriftsschlüssel mehr: Kopplung widerrufen und neu koppeln“

### Requirement: Aktionen an Unterschriftsschlüsseln landen in der Admin-Spur

Registrieren, Gegenzeichnen, Bestätigen, Ablehnen und Widerrufen eines Unterschriftsschlüssels
sowie das Verwerfen eines vom Gegenüber gelieferten Schlüssels SHALL je einen Eintrag in der
Admin-Spur der Org schreiben.

#### Scenario: Registrieren in der Spur
- **WHEN** ein Admin einen Unterschriftsschlüssel registriert
- **THEN** zeigt die Admin-Spur „Unterschriftsschlüssel registriert“ mit Fingerabdruck

#### Scenario: Bestätigen in der Spur
- **WHEN** ein Admin am ELW einen wartenden Schlüssel bestätigt
- **THEN** zeigt die Admin-Spur „Unterschriftsschlüssel bestätigt“ mit Fingerabdruck, Inhaber und Kopplung

## ADDED Requirements

### Requirement: Bestätigung eines neuen Schlüssels vom Gegenüber

Ein Admin der übernehmenden Instanz SHALL einen wartenden Schlüssel seiner Org bestätigen oder
ablehnen können, ohne eigenen Unterschriftsschlüssel. Das System MUST vorher Fingerabdruck,
Inhaber, Unterzeichner und Zeitpunkt zeigen. Bestätigen MUST die letzten vier Zeichen des
Fingerabdrucks verlangen; passen sie nicht, antwortet der Server mit 422. Ein abgelehnter
Schlüssel MUST NOT wieder gültig werden. Der Grundstock beim Koppeln gilt ohne Bestätigung.

#### Scenario: Bestätigen mit dem Fingerabdruck
- **WHEN** der Schlüssel von B am ELW wartet und ein Admin dort die letzten vier Zeichen eingibt, die B ihm nennt
- **THEN** gilt der Schlüssel von B am ELW, und Unterschriften damit werden anerkannt

#### Scenario: Falsche Zeichen
- **WHEN** ein Admin beim Bestätigen vier Zeichen eingibt, die nicht zum Ende des Fingerabdrucks passen
- **THEN** antwortet der Server mit 422, und der Schlüssel wartet weiter

#### Scenario: Nicht wartender Schlüssel
- **WHEN** ein Admin einen schon gültigen oder abgelehnten Schlüssel bestätigen will
- **THEN** antwortet der Server mit 422

#### Scenario: Ablehnen
- **WHEN** ein Admin am ELW einen wartenden Schlüssel ablehnt und der Hub ihn bei der nächsten Meldung erneut liefert
- **THEN** bleibt der Schlüssel am ELW abgelehnt

#### Scenario: Grundstock ohne Bestätigung
- **WHEN** ein ELW einen Code der Org einlöst, die zwei gültige Unterschriftsschlüssel hat
- **THEN** gelten beide am ELW sofort

#### Scenario: Hinweis an der Kopplung
- **WHEN** an einer Kopplung ein Schlüssel auf Bestätigung wartet
- **THEN** zeigt die Seite Instanzkopplung den Hinweis „1 neuer Unterschriftsschlüssel wartet auf Bestätigung“ mit dem Weg zum Bestätigen
