# Spec Delta

## MODIFIED Requirements

### Requirement: Ein Einmalcode entsteht nur aus einer bestätigten Browsersitzung
Der Server MUST einen Einmalcode nur an eine angemeldete Sitzung ausgeben und nur zusammen mit
einer `challenge`. Die `challenge` ist die base64url-kodierte SHA-256-Ableitung des `verifier`,
ohne Auffüllung, 43 Zeichen. Ohne Sitzung MUST die Antwort 401 lauten, bei einer `challenge` in
falscher Form 400. Die Webanwendung MUST den Code erst anfordern, nachdem die angemeldete Person
auf einer Bestätigungsseite ausdrücklich zugestimmt hat. Die Seite MUST dabei nennen, als wer
angemeldet wird.

#### Scenario: Bestätigung mit bestehender Sitzung
- **WHEN** eine im Browser angemeldete Person die Bestätigungsseite mit gültiger `challenge` öffnet
- **THEN** zeigt die Seite „In der Lifeline-App anmelden als <Anzeigename>“ und fordert noch keinen Code an

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
- **WHEN** die App (Mac oder iOS) den Code eingelöst hat
- **THEN** ist die Person im Browser weiterhin angemeldet, und die App hat eine eigene Sitzung
