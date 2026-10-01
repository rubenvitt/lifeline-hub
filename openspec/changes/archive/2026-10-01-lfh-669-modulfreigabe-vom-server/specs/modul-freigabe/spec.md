# Spec Delta

## Purpose

Die effektive Modulfreigabe eines Benutzers in einem Einsatz hat genau eine Quelle: den Server.
Der Client zeigt Module und lädt ihre Daten nach dieser Auskunft und rechnet die Regel nicht nach.

## ADDED Requirements

### Requirement: Der Server liefert die Modulfreigaben je Benutzer und Einsatz
Das System SHALL unter `GET /api/einsaetze/{id}/modul-freigaben` für jeden Modul-Key der Registry
einen Eintrag `{ sichtbar, zugriff }` für den anfragenden Benutzer liefern. Der Endpunkt MUST
Lesezugriff auf den Einsatz verlangen und gehört selbst keinem Modul. Er antwortet für einen
unbekannten Einsatz mit HTTP 404 und ohne Lesezugriff mit HTTP 403.

#### Scenario: Alle Module erscheinen
- **WHEN** ein Mitglied den Endpunkt für einen Einsatz ohne Overrides und ohne Org-Vorgaben aufruft
- **THEN** antwortet das System mit HTTP 200, enthält einen Eintrag je Modul-Key, und jeder Eintrag lautet `sichtbar: true, zugriff: true`

#### Scenario: Kein Lesezugriff
- **WHEN** ein Benutzer ohne Lesezugriff auf den Einsatz anfragt
- **THEN** antwortet das System mit HTTP 403

### Requirement: Zugriff folgt derselben Regel wie die Listen-Endpunkte
`zugriff` MUST für jedes Modul genau dann `true` sein, wenn der Benutzer den Listen-Endpunkt des
Moduls ohne Modulsperre aufrufen darf. Es gelten dieselben Regeln: Sichtbarkeit, Rollensperre aus
dem Einsatz-Override, sonst aus der Org-Vorgabe, die Ausnahme für System-Admins und die nicht
ausblendbaren Module.

#### Scenario: Org-Vorgabe sperrt ein Modul
- **WHEN** die Org-Vorgabe das Modul `schaeden` auf Führungskräfte beschränkt, der Einsatz keinen Override dafür hat und ein Mitglied ohne diese Berechtigung anfragt
- **THEN** lautet der Eintrag `schaeden` `sichtbar: true, zugriff: false`, und der Listen-Endpunkt der Schäden antwortet demselben Benutzer mit HTTP 403

#### Scenario: Einsatz-Override geht der Org-Vorgabe vor
- **WHEN** die Org-Vorgabe `schaeden` auf Führungskräfte beschränkt und der Einsatz-Override es auf System-Admins beschränkt
- **THEN** lautet der Eintrag `schaeden` für eine org-weite Führungskraft ohne Admin-Rechte `zugriff: false`

#### Scenario: Führungskraft
- **WHEN** die Org-Vorgabe `schaeden` auf Führungskräfte beschränkt und eine org-weite Führungskraft anfragt
- **THEN** lautet der Eintrag `schaeden` `zugriff: true`

#### Scenario: Nicht ausblendbares Modul
- **WHEN** ein Mitglied anfragt
- **THEN** lauten die Einträge `einsatzdaten` und `einsatz-einstellungen` `sichtbar: true, zugriff: true`, unabhängig von Overrides und Org-Vorgaben

### Requirement: Sichtbarkeit ist eigene Angabe
`sichtbar` MUST `false` sein, wenn der Einsatz das Modul ausblendet und das Modul ausblendbar ist,
sonst `true`. Für System-Admins gilt das ebenso. Ein ausgeblendetes Modul bleibt für sie
erreichbar (`zugriff: true`), erscheint aber in keiner Navigation.

#### Scenario: Ausgeblendetes Modul für ein Mitglied
- **WHEN** der Einsatz das Modul `meldungen` ausblendet und ein Mitglied ohne Admin-Rechte anfragt
- **THEN** lautet der Eintrag `meldungen` `sichtbar: false, zugriff: false`

#### Scenario: Ausgeblendetes Modul für einen System-Admin
- **WHEN** der Einsatz das Modul `meldungen` ausblendet und ein System-Admin anfragt
- **THEN** lautet der Eintrag `meldungen` `sichtbar: false, zugriff: true`

### Requirement: Die Navigation folgt den Freigaben des Servers
Die Navigation des Einsatzes MUST ein Modul mit `sichtbar: false` nicht zeigen. Ein Modul mit
`sichtbar: true, zugriff: false` MUST sie gesperrt zeigen, mit dem Grund „Keine Berechtigung“ und
ohne dass ein Klick dorthin führt. Rail-Sprünge in eine Kategorie und die Sprungpalette MUST
dieselbe Auskunft verwenden.

#### Scenario: Org-Vorgabe in der Navigation
- **WHEN** die Org-Vorgabe ein Modul auf Führungskräfte beschränkt und ein normales Mitglied den Einsatz öffnet
- **THEN** zeigt die Navigation das Modul gesperrt mit „Keine Berechtigung“, und der Rail-Sprung der Kategorie führt nicht dorthin

#### Scenario: Sprungpalette
- **WHEN** dasselbe Mitglied die Sprungpalette öffnet
- **THEN** bietet sie weder das Modul noch Datensätze daraus an

### Requirement: Keine Anfrage an ein nicht freigegebenes Modul
Eine Seite oder ein Rahmen, die Daten eines fremden Moduls laden, MUST dessen Listen-Endpunkt nur
abfragen, wenn die Freigaben vorliegen und das Modul `sichtbar` und `zugriff` hat. Solange die
Freigaben laden oder ihr Abruf fehlgeschlagen ist, MUST keine solche Anfrage ausgehen. Ein nicht
freigegebenes Modul MUST NOT als Ausfall einer Datenquelle gemeldet werden.

#### Scenario: Gesperrte Kartenquelle
- **WHEN** die Org-Vorgabe das Modul `schaeden` auf Führungskräfte beschränkt und ein normales Mitglied die Lagekarte öffnet
- **THEN** geht keine Anfrage an die Schadensliste, die Karte zeigt keine Schäden, und es erscheint kein Ausfallhinweis

#### Scenario: Freigaben laden noch
- **WHEN** die Lagekarte öffnet und die Freigaben noch nicht geantwortet haben
- **THEN** geht keine Anfrage an die Listen modulgebundener Kartenquellen, bis die Freigaben vorliegen

#### Scenario: Abruf der Freigaben scheitert
- **WHEN** die Lagekarte öffnet und der Abruf der Freigaben fehlschlägt
- **THEN** geht keine Anfrage an die Listen modulgebundener Kartenquellen, und der Ausfallhinweis nennt „Berechtigungen“

#### Scenario: Freie Kartenquelle
- **WHEN** das Modul `schaeden` für den Benutzer frei ist und der Abruf der Schadensliste scheitert
- **THEN** meldet die Lagekarte „Schäden“ im Ausfallhinweis wie bisher

### Requirement: Änderungen an Overrides und Org-Vorgaben wirken ohne Neuladen
Ändert ein Benutzer im Client einen Modul-Override eines Einsatzes oder eine Org-Vorgabe, MUST
der Client die Freigaben neu laden, die davon betroffen sind. Für den ändernden Benutzer zeigt die
Navigation die neue Freigabe dann ohne Neuladen der Seite.

#### Scenario: Override gesetzt
- **WHEN** eine Einsatzleitung ohne Admin-Rechte im Editor „Module“ ein Modul ausblendet
- **THEN** verschwindet das Modul aus ihrer Navigation, ohne dass sie die Seite neu lädt
