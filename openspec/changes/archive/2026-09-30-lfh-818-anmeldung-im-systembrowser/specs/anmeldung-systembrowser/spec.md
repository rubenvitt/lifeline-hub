# Spec Delta

## Purpose

Eine Anmeldung, die im Browser stattgefunden hat, wird per Einmalcode in einen anderen
Cookie-Speicher übergeben, heute in den Webview der macOS-Hülle. Der Code ist an ein Geheimnis
gebunden, das nur der anfragende Client kennt. So kann weder ein abgefangener noch ein
untergeschobener Code eine Sitzung erzeugen.

## ADDED Requirements

### Requirement: Ein Einmalcode entsteht nur aus einer bestätigten Browsersitzung
Der Server MUST einen Einmalcode nur an eine angemeldete Sitzung ausgeben und nur zusammen mit
einer `challenge`. Die `challenge` ist die base64url-kodierte SHA-256-Ableitung des `verifier`,
ohne Auffüllung, 43 Zeichen. Ohne Sitzung MUST die Antwort 401 lauten, bei einer `challenge` in
falscher Form 400. Die Webanwendung MUST den Code erst anfordern, nachdem die angemeldete Person
auf einer Bestätigungsseite ausdrücklich zugestimmt hat. Die Seite MUST dabei nennen, als wer
angemeldet wird.

#### Scenario: Bestätigung mit bestehender Sitzung
- **WHEN** eine im Browser angemeldete Person die Bestätigungsseite mit gültiger `challenge` öffnet
- **THEN** zeigt die Seite „In der Mac-App anmelden als <Anzeigename>“ und fordert noch keinen Code an

#### Scenario: Ohne Sitzung
- **WHEN** jemand ohne Sitzung die Bestätigungsseite öffnet
- **THEN** führt die Seite zur Anmeldung und nach jeder erfolgreichen Anmeldung (Passwort, TOTP, OIDC, Passkey) zurück zur Bestätigung, mit derselben `challenge`

#### Scenario: Anderes Konto
- **WHEN** die Person auf der Bestätigungsseite „Mit anderem Konto“ wählt
- **THEN** wird sie im Browser abgemeldet und landet auf der Anmeldung, mit dem Rückweg zur Bestätigung

#### Scenario: Code ohne Sitzung
- **WHEN** ein Code ohne Sitzungs-Cookie angefordert wird
- **THEN** antwortet der Server mit 401, und es entsteht kein Code

#### Scenario: Challenge in falscher Form
- **WHEN** die `challenge` nicht aus 43 base64url-Zeichen besteht
- **THEN** antwortet der Server mit 400

### Requirement: Der Code springt nur über das Schema der App zurück
Nach der Zustimmung MUST die Webanwendung den Code ausschließlich als
`lifeline://anmeldung?code=<code>` weitergeben. Sie MUST ihn nicht an eine andere Adresse
senden, nicht in den Verlauf der Serveradresse schreiben und nicht anzeigen.

#### Scenario: Zustimmung
- **WHEN** die Person auf der Bestätigungsseite „In der App anmelden“ wählt
- **THEN** navigiert der Browser auf `lifeline://anmeldung?code=…`, und die Seite sagt, dass das Fenster geschlossen werden kann

### Requirement: Nur der passende verifier löst den Code ein
Der Server MUST einen Code nur einlösen, wenn der mitgesendete `verifier` zur `challenge`
passt, an die der Code gebunden wurde. Der `verifier` MUST im Anfragekörper stehen, nie in
einer URL. Jeder Einlöseversuch, der die Formprüfung und die Sperre der Adresse passiert, MUST
den Code verbrauchen, auch ein gescheiterter.

#### Scenario: Passender verifier
- **WHEN** der Code innerhalb der Frist mit dem passenden `verifier` eingelöst wird
- **THEN** setzt der Server im antwortenden Cookie-Speicher eine neue Sitzung für die Person, die zugestimmt hat

#### Scenario: Untergeschobener Code
- **WHEN** ein Code, der für eine fremde `challenge` ausgestellt wurde, mit einem anderen `verifier` eingelöst wird
- **THEN** entsteht keine Sitzung, und der Code ist danach verbraucht

### Requirement: Der Code gilt einmal und kurz
Ein Code MUST nach dem ersten Einlöseversuch und nach 60 Sekunden ab Ausstellung ungültig sein.
Ein Neustart des Servers MUST alle offenen Codes verwerfen.

#### Scenario: Zweites Einlösen
- **WHEN** ein bereits eingelöster Code erneut eingelöst wird
- **THEN** entsteht keine Sitzung

#### Scenario: Frist abgelaufen
- **WHEN** ein Code nach Ablauf der Frist eingelöst wird
- **THEN** entsteht keine Sitzung

### Requirement: Eine gescheiterte Einlösung nennt keinen Grund
Gibt es keinen Code, ist er abgelaufen oder verbraucht, passt der `verifier` nicht oder ist das
Konto inzwischen deaktiviert, MUST der Server mit derselben Antwort ablehnen: 401 mit demselben
Text. Ein Anfragekörper in falscher Form (Feld fehlt, leer, falscher Typ, `verifier` nicht
43–128 Zeichen aus dem PKCE-Zeichenvorrat) MUST mit 400 abgelehnt werden.

#### Scenario: Unbekannter und falsch gebundener Code
- **WHEN** einmal ein unbekannter Code und einmal ein Code mit falschem `verifier` eingelöst wird
- **THEN** sind beide Antworten 401 und in Status und Text gleich

#### Scenario: Leerer verifier
- **WHEN** der `verifier` fehlt oder leer ist
- **THEN** antwortet der Server mit 400

### Requirement: Die Einlösung ist eine Anmeldung wie jede andere
Eine erfolgreiche Einlösung MUST eine eigene Sitzung mit derselben Lebensdauer und denselben
Cookie-Eigenschaften anlegen wie die übrigen Anmeldewege. Sie MUST einen Audit-Eintrag
`login_ok` mit Benutzer, Adresse und dem Anbieter `systembrowser` schreiben. Eine gescheiterte
Einlösung MUST `login_fehlgeschlagen` mit dem Anbieter `systembrowser` schreiben und als
Fehlversuch der Adresse zählen. Die Browsersitzung, aus der der Code stammt, MUST davon
unberührt bleiben.

#### Scenario: Audit nach Einlösung
- **WHEN** ein Code erfolgreich eingelöst wird
- **THEN** steht in `auth_audit` ein `login_ok` mit dem Anbieter `systembrowser` und dem Benutzer

#### Scenario: Browsersitzung bleibt
- **WHEN** die Mac-App den Code eingelöst hat
- **THEN** ist die Person im Browser weiterhin angemeldet, und die Mac-App hat eine eigene Sitzung
