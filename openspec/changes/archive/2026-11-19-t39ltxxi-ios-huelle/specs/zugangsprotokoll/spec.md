# Spec Delta

## MODIFIED Requirements

### Requirement: Anmeldeweg im Klartext

Das Zugangsprotokoll SHALL jeden Anmeldeweg, den der Server in die Anmeldespur schreibt, mit
einem Klartext zeigen und MUST NOT eine interne Kennung zeigen. Die Bezeichnungen sind:
Passwort, SSO, Passkey, Entwicklung, Zweiter Faktor, Gerätecode, Lifeline-App. Ein unbekannter
Anmeldeweg erscheint als „—“.

#### Scenario: Anmeldung mit zweitem Faktor

- **WHEN** sich eine Person mit Passwort und Einmalcode anmeldet und ein Admin die Anmeldespur
  öffnet
- **THEN** steht in der Spalte „Anmeldeweg“ der Zeile „Anmeldung“ „Zweiter Faktor“

#### Scenario: Gekoppeltes Gerät

- **WHEN** ein Gerät seinen Kopplungscode einlöst
- **THEN** steht beim Eintrag der Anmeldeweg „Gerätecode“

#### Scenario: Anmeldung in der Mac-App

- **WHEN** sich die Mac- oder iOS-App über den Systembrowser anmeldet
- **THEN** steht beim Eintrag der Anmeldeweg „Lifeline-App“

#### Scenario: Neuer Anmeldeweg ohne Klartext

- **WHEN** der Server einen Anmeldeweg einführt, für den das Frontend keinen Klartext hat
- **THEN** schlägt die Typprüfung des Frontends fehl, bevor der Wert roh in der Liste erscheint
