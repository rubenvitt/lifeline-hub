# Spec Delta

## Purpose

Legt fest, was das Zugangsprotokoll der Verwaltung einem System-Admin zeigt und wie es filtert:
Anmeldespur und Zugangsänderungen in Klartext statt interner Kennungen, mit dem tatsächlichen
Anmeldeweg einer Sitzung und Zeiten in den Konventionen der Organisation.

## ADDED Requirements

### Requirement: Anmeldeweg im Klartext

Das Zugangsprotokoll SHALL jeden Anmeldeweg, den der Server in die Anmeldespur schreibt, mit
einem Klartext zeigen und MUST NOT eine interne Kennung zeigen. Die Bezeichnungen sind:
Passwort, SSO, Passkey, Entwicklung, Zweiter Faktor, Gerätecode, Mac-App. Ein unbekannter
Anmeldeweg erscheint als „—“.

#### Scenario: Anmeldung mit zweitem Faktor

- **WHEN** sich eine Person mit Passwort und Einmalcode anmeldet und ein Admin die Anmeldespur
  öffnet
- **THEN** steht in der Spalte „Anmeldeweg“ der Zeile „Anmeldung“ „Zweiter Faktor“

#### Scenario: Gekoppeltes Gerät

- **WHEN** ein Gerät seinen Kopplungscode einlöst
- **THEN** steht beim Eintrag der Anmeldeweg „Gerätecode“

#### Scenario: Anmeldung in der Mac-App

- **WHEN** sich die Mac-App über den Systembrowser anmeldet
- **THEN** steht beim Eintrag der Anmeldeweg „Mac-App“

#### Scenario: Neuer Anmeldeweg ohne Klartext

- **WHEN** der Server einen Anmeldeweg einführt, für den das Frontend keinen Klartext hat
- **THEN** schlägt die Typprüfung des Frontends fehl, bevor der Wert roh in der Liste erscheint

### Requirement: Anmeldeweg der Sitzung bei Abmeldung und Beenden

Eine Sitzung SHALL sich den Anmeldeweg merken, mit dem sie entstand. Abmeldung und „Sitzung
beendet“ MUST diesen Anmeldeweg in die Anmeldespur schreiben. Kennt die Sitzung ihren
Anmeldeweg nicht, MUST der Eintrag „unbekannt“ tragen und das Zugangsprotokoll „—“ zeigen,
nie einen geratenen Weg.

#### Scenario: Abmeldung nach Passkey-Anmeldung

- **WHEN** sich eine Person per Passkey anmeldet und danach abmeldet
- **THEN** zeigt die Zeile „Abmeldung“ den Anmeldeweg „Passkey“

#### Scenario: Eigene Sitzung beendet

- **WHEN** eine Person in ihrer Sitzungsliste eine andere ihrer Sitzungen beendet, die per SSO
  entstand
- **THEN** zeigt die Zeile „Sitzung beendet“ den Anmeldeweg „SSO“

#### Scenario: Sitzung von vor dem Update

- **WHEN** sich eine Person aus einer Sitzung abmeldet, die vor diesem Update angelegt wurde
- **THEN** zeigt die Zeile „Abmeldung“ beim Anmeldeweg „—“

### Requirement: Detail der Zugangsänderungen ohne Rohwerte

Das Detail einer Zugangsänderung MUST Rollen mit den Bezeichnungen aus dem Benutzer-Dialog
zeigen und MUST NOT interne Rollen-Kennungen zeigen. Der Anmeldezeitpunkt einer beendeten
Sitzung MUST in Zeitzone und Zeitformat der Organisation erscheinen, wie die Spalte
„Zeitpunkt“. Einträge, die vor diesem Update geschrieben wurden, bleiben unverändert.

#### Scenario: Rolle geändert

- **WHEN** ein Admin die Org-Rolle eines Kontos von „Keine“ auf „Führungskraft“ ändert
- **THEN** zeigt das Detail der Zeile „Rolle geändert“ „Org-Rolle: Keine → Führungskraft“

#### Scenario: Konto angelegt

- **WHEN** ein Admin ein Konto mit System-Rolle „Benutzer“ und Org-Rolle „Keine“ anlegt
- **THEN** zeigt das Detail der Zeile „Konto angelegt“ „System-Rolle: Benutzer, Org-Rolle: Keine“

#### Scenario: Sitzung durch Admin beendet

- **WHEN** ein Admin eine Sitzung beendet, die um 12:13:34 UTC auf einem iPad entstand, und die
  Organisation die Zone Europe/Berlin hat
- **THEN** zeigt das Detail „iPad, angemeldet 101413OKT2026“ (taktische DTG in Ortszeit), ohne
  UTC-Zeitstempel

#### Scenario: Eintrag von vor dem Update

- **WHEN** die Admin-Spur einen Eintrag mit einem vor dem Update geschriebenen Detail enthält
- **THEN** erscheint dieses Detail unverändert

### Requirement: Kontofilter mit Teiltreffern

Der Kontofilter beider Spuren SHALL jeden Eintrag treffen, dessen Konto den eingegebenen Text
enthält, ohne Rücksicht auf Groß- und Kleinschreibung. In der Admin-Spur zählen handelnde
Person und Zielkonto, nie ein Anmeldeweg gleichen Namens.

#### Scenario: Tippen eines Namensanfangs

- **WHEN** es Anmeldungen von „ruben“ und „rubina“ gibt und ein Admin im Kontofeld „rub“ tippt
- **THEN** zeigt die Anmeldespur die Einträge beider Konten

#### Scenario: Teil in der Mitte, andere Schreibweise

- **WHEN** ein Admin im Kontofeld „BEN“ tippt
- **THEN** zeigt die Anmeldespur die Einträge von „ruben“

#### Scenario: Anmeldeweg ist kein Konto

- **WHEN** ein Admin in der Admin-Spur „passwort“ als Konto filtert und der Anmeldeweg Passwort
  geschaltet wurde
- **THEN** erscheint die Zeile „Anmeldeweg deaktiviert“ dieses Anmeldewegs nicht

#### Scenario: Kein Treffer

- **WHEN** kein protokolliertes Konto den getippten Text enthält
- **THEN** zeigt die Spur ihren Leertext
