# org-admin-unterschrift Specification

## Purpose
Org-Admins unterschreiben folgenschwere Erklärungen (etwa eine Notübernahme) mit einem eigenen
Passkey, den gekoppelte Instanzen kennen und prüfen können, sodass eine Instanz eine solche
Erklärung einem Menschen zuordnen kann und nicht dem Server glauben muss, der sie überbringt.

## Requirements

### Requirement: Eigener Unterschriftsschlüssel je Admin

Ein Admin SHALL an seiner Instanz einen Passkey als Unterschriftsschlüssel registrieren können,
getrennt von seinen Anmeldewegen. Ein Unterschriftsschlüssel MUST NOT zur Anmeldung taugen, und
ein Anmelde-Passkey MUST NOT als Unterschriftsschlüssel gelten. Nur Admins MUST einen
registrieren können.

#### Scenario: Registrieren
- **WHEN** ein Admin auf der Seite „Instanzkopplung“ „Unterschriftsschlüssel registrieren“ wählt und den Passkey bestätigt
- **THEN** erscheint der Schlüssel mit Bezeichnung, Fingerabdruck und Datum in der Liste seiner Org

#### Scenario: Anmelden mit dem Unterschriftsschlüssel
- **WHEN** jemand versucht, sich mit dem Unterschriftsschlüssel anzumelden
- **THEN** scheitert die Anmeldung wie mit einem unbekannten Passkey

#### Scenario: Kein Admin
- **WHEN** ein Konto ohne Admin-Rolle einen Unterschriftsschlüssel registrieren will
- **THEN** antwortet der Server mit 403

### Requirement: Gekoppelte Instanzen kennen die Schlüssel der Org

Beim Einlösen eines Kopplungscodes SHALL die ausstellende Instanz der einlösenden alle gültigen
Unterschriftsschlüssel der Org übergeben. Danach MUST sie Neuzugänge und Widerrufe bei jeder
Meldung nachliefern, die das Gegenüber noch nicht hat.

#### Scenario: Grundstock beim Koppeln
- **WHEN** ein ELW einen Code der Org „DRK KV Nord“ einlöst, die zwei gültige Unterschriftsschlüssel hat
- **THEN** zeigt der ELW für diese Org zwei Unterschriftsschlüssel mit denselben Fingerabdrücken wie der Hub

### Requirement: Neue Schlüssel nur mit Unterschrift eines bekannten Admins

Ein neuer Unterschriftsschlüssel SHALL erst verteilt werden, wenn ein Admin der Org ihn mit einem
schon gültigen Unterschriftsschlüssel unterschrieben hat. Die empfangende Instanz MUST einen
neuen Schlüssel nur annehmen, wenn die Unterschrift von einem ihr bekannten, gültigen Schlüssel
derselben Org stammt; sonst MUST sie ihn verwerfen und den Vorfall anzeigen.

#### Scenario: Gegengezeichneter Schlüssel
- **WHEN** Admin B einen Schlüssel registriert, Admin A ihn mit seinem Unterschriftsschlüssel gegenzeichnet und der ELW sich meldet
- **THEN** kennt der ELW danach auch den Schlüssel von B

#### Scenario: Hub schiebt einen fremden Schlüssel unter
- **WHEN** ein Hub einem ELW einen Schlüssel ohne gültige Gegenzeichnung eines dem ELW bekannten Schlüssels liefert
- **THEN** verwirft der ELW ihn und zeigt „ungültiger Unterschriftsschlüssel vom Gegenüber abgelehnt“ in der Kopplung und in der Admin-Spur

#### Scenario: Erster Schlüssel der Org
- **WHEN** ein Admin den ersten Unterschriftsschlüssel einer Org registriert
- **THEN** gilt er an seiner Instanz ohne Gegenzeichnung, weil noch keine Kopplung der Org besteht

### Requirement: Widerruf eines Unterschriftsschlüssels

Ein Admin SHALL eigene Unterschriftsschlüssel und die anderer Admins seiner Org widerrufen können;
wird ein Admin-Konto deaktiviert oder verliert es die Admin-Rolle, MUST das System seine
Unterschriftsschlüssel widerrufen. Eine gekoppelte Instanz MUST einen Widerruf vom Gegenüber ohne
Gegenzeichnung annehmen. Der letzte gültige Schlüssel einer gekoppelten Org MUST NOT widerrufbar
sein, solange keine Kopplung der Org widerrufen ist.

#### Scenario: Widerruf erreicht den ELW
- **WHEN** der Hub den Schlüssel von Admin B widerruft und der ELW sich meldet
- **THEN** zeigt der ELW den Schlüssel als widerrufen und nimmt keine Unterschrift damit mehr an

#### Scenario: Letzter Schlüssel
- **WHEN** ein Admin den einzigen gültigen Unterschriftsschlüssel einer Org mit bestehender Kopplung widerrufen will
- **THEN** antwortet der Server mit 409 und nennt die Kopplungen

### Requirement: Unterschrift über eine vorgegebene Erklärung prüfen

Das System SHALL eine Passkey-Unterschrift prüfen können, deren Challenge der Hash einer
vorgegebenen Erklärung ist, auch wenn der Passkey an einer anderen Instanz registriert wurde. Die
Prüfung MUST Challenge, Herkunft der registrierenden Instanz, Nutzerpräsenz und
Nutzerverifikation sowie die Signatur gegen einen gültigen Unterschriftsschlüssel der Org
verlangen.

#### Scenario: Gegenzeichnung am Hub geprüft am ELW
- **WHEN** der ELW eine Gegenzeichnung erhält, die Admin A am Hub über den Hash des neuen Schlüssels geleistet hat
- **THEN** erkennt der ELW sie als gültig

#### Scenario: Andere Erklärung
- **WHEN** eine gültige Unterschrift über eine Erklärung X einer Erklärung Y beigelegt wird
- **THEN** erkennt die prüfende Instanz sie als ungültig

### Requirement: Aktionen an Unterschriftsschlüsseln landen in der Admin-Spur

Registrieren, Gegenzeichnen und Widerrufen eines Unterschriftsschlüssels sowie das Verwerfen
eines vom Gegenüber gelieferten Schlüssels SHALL je einen Eintrag in der Admin-Spur der Org
schreiben.

#### Scenario: Registrieren in der Spur
- **WHEN** ein Admin einen Unterschriftsschlüssel registriert
- **THEN** zeigt die Admin-Spur „Unterschriftsschlüssel registriert“ mit Fingerabdruck
