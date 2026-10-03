# Spec Delta

## Purpose

Der angemeldete Benutzer ändert sein lokales Passwort selbst über die Profilseite. Die Fähigkeit
legt fest, wann die Seite diesen Weg anbietet und welche Angabe die API dafür liefert.

## ADDED Requirements

### Requirement: Die Benutzerdarstellung sagt, ob ein lokales Passwort gesetzt ist

Jede Benutzerdarstellung der API MUST das Feld `passwort_gesetzt` (bool) tragen. Es ist `true`
genau dann, wenn das Konto ein lokales Passwort hat. Ein SSO-only-Konto hat keins.
Passwort-Hash und SSO-Sentinel MUST NOT in einer Antwort erscheinen.

#### Scenario: Konto mit lokalem Passwort

- **WHEN** ein Benutzer mit lokalem Passwort `GET /api/auth/me` abruft
- **THEN** enthält die Antwort `"passwort_gesetzt": true`

#### Scenario: SSO-only-Konto

- **WHEN** ein per OIDC angelegtes Konto ohne lokales Passwort `GET /api/auth/me` abruft
- **THEN** enthält die Antwort `"passwort_gesetzt": false`
- **AND** die Antwort enthält weder den Passwort-Hash noch den SSO-Sentinel

#### Scenario: Admin-Benutzerliste

- **WHEN** ein Admin `GET /api/benutzer` abruft und dort ein SSO-only-Konto steht
- **THEN** trägt dessen Eintrag `"passwort_gesetzt": false`
- **AND** jedes Konto mit lokalem Passwort trägt `"passwort_gesetzt": true`

### Requirement: Die Profilseite bietet den Passwortwechsel nur an, wenn er wirken kann

Die Profilseite MUST den Abschnitt „Passwort“ samt Knopf „Passwort ändern“ nur zeigen, wenn
beides gilt: Der Passwort-Provider ist aktiv, und der angemeldete Benutzer hat ein lokales
Passwort (`passwort_gesetzt`). Fehlt eine der Bedingungen, MUST der Abschnitt ganz fehlen,
nicht nur deaktiviert sein.

#### Scenario: Konto mit Passwort und aktivem Provider

- **WHEN** ein Benutzer mit lokalem Passwort die Profilseite öffnet und der Passwort-Provider aktiv ist
- **THEN** zeigt die Seite den Abschnitt „Passwort“ mit dem Knopf „Passwort ändern“

#### Scenario: SSO-only-Konto bei aktivem Provider

- **WHEN** ein SSO-only-Konto die Profilseite öffnet und der Passwort-Provider aktiv ist
- **THEN** zeigt die Seite keinen Abschnitt „Passwort“ und keinen Knopf „Passwort ändern“

#### Scenario: Passwort-Provider nicht aktiv

- **WHEN** ein Benutzer mit lokalem Passwort die Profilseite öffnet und der Passwort-Provider deaktiviert ist oder fehlt
- **THEN** zeigt die Seite keinen Abschnitt „Passwort“
