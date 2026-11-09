# passwort-anmeldung Specification

## Purpose
Legt fest, wie der Server einen Benutzernamen bei Anmeldung und Benutzeranlage annimmt, vergleicht
und protokolliert, und wann ein gescheiterter Anmeldeversuch als Fehlversuch für die Sperre zählt.

## Requirements

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
Die Abweisung MUST als 413 im `{error}`-Format kommen, wie jeder Body über dem Limit seiner
Route (Spec `eingabegrenzen`).

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

### Requirement: Die Benutzeranlage hasht unter der Überlastgrenze

Die Benutzeranlage MUST das neue Passwort unter derselben Grenze gleichzeitiger
Passwortberechnungen hashen wie der Login und darf dabei keinen Server-Thread für Anfragen
blockieren. Ist die Grenze über die Wartefrist ausgeschöpft, MUST die Anlage mit 503 scheitern.

#### Scenario: Anlage bei ausgeschöpfter Grenze

- **WHEN** alle Plätze für Passwortberechnungen über die Wartefrist belegt sind und ein Admin einen Benutzer anlegt
- **THEN** antwortet der Server mit 503 und legt keinen Benutzer an

### Requirement: Ein neues Passwort passt in den Login

Ein neues Passwort MUST höchstens 128 Zeichen lang sein; ein längeres MUST der Server bei Anlage
und Self-Service-Wechsel mit 400 abweisen. So bleibt jedes setzbare Passwort unter der
Body-Grenze des Logins eingebbar.

#### Scenario: Anlage mit überlangem Passwort

- **WHEN** ein Admin einen Benutzer mit einem Passwort aus 129 Zeichen anlegt
- **THEN** antwortet der Server mit 400

#### Scenario: Längstes Passwort meldet an

- **WHEN** ein Benutzer mit einem Passwort aus 128 Zeichen angelegt wurde und sich damit anmeldet
- **THEN** antwortet der Server mit einer Sitzung

### Requirement: Admins mit Passkey melden sich an einer verteilenden Instanz nicht per Passwort an

Eine Instanz verteilt die Geheimnisse einer Org, solange sie für diese Org die erreichte Seite
einer aktiven Org-Zuordnung ist (Fähigkeit `stammdaten-verteilung`). Dort MUST ein Passwort-Login
eines System-Admins dieser Org mit mindestens einem Anmelde-Passkey abgewiesen werden, auch bei
richtigem Passwort und richtigem zweiten Faktor. Bei richtigem Passwort MUST die
Abweisung 403 mit dem Text „Admins melden sich hier per Passkey an“ sein. Sie MUST NOT als
Fehlversuch zählen. Ein falsches Passwort MUST wie bisher mit 401 scheitern. Ein System-Admin ohne
Anmelde-Passkey MUST sich weiter per Passwort anmelden können. Für Orgs, deren Geheimnisse die
Instanz nicht verteilt, MUST sich nichts ändern. Ging der Passwort-Hash eines System-Admins an
eine andere Instanz, MUST die Abweisung auch nach dem Widerruf der Zuordnung gelten, bis diese
Instanz als verloren gemeldet ist.

#### Scenario: Admin mit Passkey am Hub
- **WHEN** der Hub die Org von „anna“ an einen ELW verteilt, „anna“ System-Admin ist, einen Anmelde-Passkey hat und sich am Hub mit richtigem Passwort anmelden will
- **THEN** antwortet der Hub mit 403 „Admins melden sich hier per Passkey an“, und es entsteht keine Sitzung

#### Scenario: Derselbe Admin am ELW
- **WHEN** „anna“ sich ohne Netz am ELW mit ihrem Passwort anmeldet
- **THEN** gelingt die Anmeldung, denn der ELW verteilt nichts

#### Scenario: Admin ohne Passkey
- **WHEN** der Admin „bert“ am Hub keinen Anmelde-Passkey hat
- **THEN** meldet er sich am Hub weiter per Passwort an

#### Scenario: Nach dem Widerruf
- **WHEN** der Hub die Kopplung widerruft, nachdem der Hash von „anna“ an den ELW ging
- **THEN** weist der Hub ihren Passwort-Login weiter mit 403 ab

### Requirement: Ein Admin ohne seinen Passkey kommt über ein Einmalpasswort zurück

Gilt für einen System-Admin die Passkey-Pflicht, MUST ein Einmalpasswort aus der
Benutzerverwaltung zugleich seine Anmelde-Passkeys entfernen, und die Admin-Spur MUST ihre Zahl
nennen. Wo die Pflicht nicht gilt, MUST das Einmalpasswort Passkeys unberührt lassen. Der
Startbefehl `admin-zugang-zuruecksetzen <benutzername>` MUST dasselbe für einen System-Admin ohne
eine andere Person tun: Anmelde-Passkeys entfernen, ein Einmalpasswort mit Wechselpflicht am
Terminal ausgeben, Sitzungen beenden und einen Eintrag ohne Akteur in die Admin-Spur schreiben. Für
andere Konten MUST er abbrechen.

#### Scenario: Passkey verloren, ein anderer Admin hilft
- **WHEN** „anna“ ihren Passkey verliert und „bert“ ihr am Hub ein Einmalpasswort gibt
- **THEN** sind ihre Anmelde-Passkeys entfernt, und sie meldet sich mit dem Einmalpasswort an und legt ein eigenes Passwort fest

#### Scenario: Der letzte Admin
- **WHEN** der einzige Admin seinen Passkey verliert und der Betrieb `admin-zugang-zuruecksetzen anna` am Server ausführt
- **THEN** steht am Terminal ein Einmalpasswort, mit dem „anna“ sich anmelden kann
