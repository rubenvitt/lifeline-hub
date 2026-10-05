# Spec Delta

## Purpose

Legt fest, wie der Server einen Benutzernamen bei Anmeldung und Benutzeranlage annimmt, vergleicht
und protokolliert, und wann ein gescheiterter Anmeldeversuch als Fehlversuch für die Sperre zählt.

## ADDED Requirements

### Requirement: Leerzeichen am Rand des Benutzernamens zählen nicht

Der Server MUST Leerzeichen am Anfang und Ende eines Benutzernamens abschneiden, bevor er ihn bei
Passwort-Login, Passkey-Start mit Namen oder Benutzeranlage verwendet. Ein Passwort MUST NOT
getrimmt werden.

#### Scenario: Angehängtes Leerzeichen beim Login

- **WHEN** der Benutzer `admin` sich mit dem Namen `" admin "` und seinem Passwort anmeldet
- **THEN** antwortet der Server mit einer Sitzung statt 401

#### Scenario: Anlage mit Leerzeichen

- **WHEN** ein Admin einen Benutzer mit dem Namen `"  max "` anlegt
- **THEN** heißt der angelegte Benutzer `max`

### Requirement: Benutzernamen werden ohne Groß-/Kleinschreibung verglichen

Passwort-Login und Passkey-Start mit Namen MUST einen Benutzer unabhängig von der Groß- und
Kleinschreibung der Buchstaben A–Z finden. Die gespeicherte Schreibweise MUST unverändert
bleiben. Ein deaktivierter Benutzer MUST in jeder Schreibweise abgewiesen werden.

#### Scenario: Großgeschriebener Anfangsbuchstabe

- **WHEN** der Benutzer `admin` sich mit `Admin` oder `ADMIN` und seinem Passwort anmeldet
- **THEN** antwortet der Server mit einer Sitzung für `admin`

#### Scenario: Deaktiviertes Konto in anderer Schreibweise

- **WHEN** sich jemand mit `Max` für den deaktivierten Benutzer `max` anmeldet
- **THEN** antwortet der Server mit 401 „Benutzername oder Passwort ist falsch“

#### Scenario: Passkey-Start mit abweichender Schreibweise

- **WHEN** der Passkey-Start mit dem Namen `MAX` für den Benutzer `max` mit Passkey aufgerufen wird
- **THEN** liefert der Server die Challenge für `max`

### Requirement: Ein Benutzername ist ohne Groß-/Kleinschreibung eindeutig

Der Server MUST einen neuen Benutzer abweisen, dessen Name sich von einem bestehenden nur in der
Groß-/Kleinschreibung unterscheidet, mit 409. Eine automatische Kontoanlage über SSO MUST einen
solchen Namen als vergeben behandeln und auf einen freien ausweichen.

#### Scenario: Zweiter Name in anderer Schreibweise

- **WHEN** ein Admin `Admin` anlegt, während `admin` existiert
- **THEN** antwortet der Server mit 409 „Benutzername ist bereits vergeben“

#### Scenario: SSO-Erstanmeldung trifft auf lokalen Namen

- **WHEN** sich ein SSO-Benutzer mit `preferred_username` `max` erstmals anmeldet, während das lokale Konto `Max` existiert
- **THEN** legt der Server das SSO-Konto unter einem freien Namen wie `max-2` an

### Requirement: Bestehende Kollisionen brechen die Umstellung sichtbar ab

Enthält eine Installation beim Update bereits zwei Benutzernamen, die sich nur in der
Groß-/Kleinschreibung unterscheiden, MUST das Update mit einer Meldung abbrechen, die das
Problem benennt. Es MUST NOT einen Namen still umbenennen.

#### Scenario: Update mit Kollision

- **WHEN** die Datenbank die Benutzer `max` und `Max` enthält und der Server mit dieser Änderung startet
- **THEN** bricht der Start mit einer Meldung ab, die die Kollision der Benutzernamen nennt
- **AND** beide Benutzer bleiben unverändert

### Requirement: Benutzernamen haben eine Höchstlänge

Ein Benutzername MUST nach dem Abschneiden der Randleerzeichen höchstens 128 Zeichen lang sein.
Ist er länger, MUST der Server Login, Passkey-Start und Anlage mit 400 abweisen, ohne Eintrag in
`auth_audit`, ohne Log-Zeile mit dem Namen und ohne den Versuch als Fehlversuch zu zählen.

#### Scenario: Login mit überlangem Namen

- **WHEN** ein Login mit einem Benutzernamen aus 129 Zeichen eintrifft
- **THEN** antwortet der Server mit 400 im `{error}`-Format
- **AND** `auth_audit` hat keine neue Zeile
- **AND** die Quelle hat keinen Fehlversuch mehr als vorher

#### Scenario: Anlage mit überlangem Namen

- **WHEN** ein Admin einen Benutzer mit 129 Zeichen langem Namen anlegt
- **THEN** antwortet der Server mit 400

### Requirement: Öffentliche Anmelderouten begrenzen den Body

Die öffentlichen Anmelderouten MUST Bodies über ihrer Grenze abweisen, bevor sie den Inhalt
verarbeiten: Passwort-Login und die Passkey-Starts bei 4 KiB, die Passkey-Abschlüsse bei 16 KiB.
Die Abweisung MUST im `{error}`-Format kommen.

#### Scenario: Zu großer Login-Body

- **WHEN** an `POST /api/auth/login` ein Body über 4 KiB geschickt wird
- **THEN** antwortet der Server mit 413 im `{error}`-Format

### Requirement: Benutzernamen in Protokollen sind gekürzt

Ein Benutzername in `auth_audit` und in Log-Feldern der Anmeldung MUST höchstens 64 Zeichen plus
„…“ umfassen. Die Abweisung wegen gesperrter Quelle (429) MUST den Benutzernamen nicht loggen.

#### Scenario: Langer, gültiger Name im Audit

- **WHEN** ein Login mit einem 100 Zeichen langen, unbekannten Namen scheitert
- **THEN** steht in `auth_audit` der Name auf 64 Zeichen gekürzt mit angehängtem „…“

### Requirement: Nur ein falsches Passwort zählt als Fehlversuch

Ein Passwort-Login MUST nur dann als Fehlversuch zählen und `login_fehlgeschlagen` schreiben,
wenn er mit 401 scheitert. Eine Abweisung mit 503 wegen Überlast der Passwortprüfung MUST 503
bleiben, MUST NOT zählen und MUST NOT `login_fehlgeschlagen` schreiben. Fehlversuche gegen
dasselbe Konto in unterschiedlicher Schreibweise MUST als Versuche gegen ein Konto gelten.

#### Scenario: Überlast in der Anmeldewelle

- **WHEN** von einer Quelle mehr als zehn Logins wegen Überlast mit 503 abgewiesen werden
- **THEN** ist die Quelle nicht gesperrt
- **AND** `auth_audit` hat keine Zeile `login_fehlgeschlagen` für diese Versuche

#### Scenario: Falsches Passwort sperrt weiter

- **WHEN** von einer Quelle zehn Logins mit falschem Passwort scheitern
- **THEN** antwortet der nächste Login dieser Quelle mit 429

#### Scenario: Vertippt in anderer Schreibweise, dann angemeldet

- **WHEN** eine Quelle sich zweimal mit `Max` und falschem Passwort vertippt und dann als `max` erfolgreich anmeldet
- **THEN** sind die beiden Fehlversuche dieser Quelle geräumt

### Requirement: Passwort-Hashing in Anfragen läuft unter der Überlastgrenze

Benutzeranlage und Self-Service-Passwortwechsel MUST das neue Passwort unter derselben Grenze
gleichzeitiger Passwortberechnungen hashen wie der Login und dürfen dabei keinen Server-Thread für
Anfragen blockieren. Ist die Grenze über die Wartefrist ausgeschöpft, MUST die Anfrage mit 503
scheitern.

#### Scenario: Anlage bei ausgeschöpfter Grenze

- **WHEN** alle Plätze für Passwortberechnungen über die Wartefrist belegt sind und ein Admin einen Benutzer anlegt
- **THEN** antwortet der Server mit 503 und legt keinen Benutzer an
