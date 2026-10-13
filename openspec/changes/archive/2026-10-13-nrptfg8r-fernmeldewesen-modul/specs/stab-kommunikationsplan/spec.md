## RENAMED Requirements

- FROM: `### Requirement: Eigene Adresse unter dem Stab mit Einstieg aus der S6-Zeile`
- TO: `### Requirement: Eigene Adresse im Modul Fernmeldewesen`

## MODIFIED Requirements

### Requirement: Eigene Adresse im Modul Fernmeldewesen
Der Kommunikationsplan SHALL unter `/einsaetze/:id/fernmeldewesen/kommunikationsplan` als
Lesezeichen tauglich erreichbar sein, als Reiter „Kommunikationsplan“ des Moduls Fernmeldewesen und
mit diesem Modul als aktiv in der Navigation. Er SHALL Sichtbarkeit und Sperre des Moduls
Fernmeldewesen erben, nicht die des Stabs; den Fall ohne Zugriff fängt der Einsatzrahmen ab
(Capability `modul-freigabe`). Die alte Adresse `/einsaetze/:id/stab/kommunikationsplan` SHALL auf
die neue umleiten. Die S6-Zeile der Stabseite SHALL einen Verweis „Kommunikationsplan“ tragen,
gesperrt, solange das Fernmeldewesen für die Person gesperrt ist. Solange die Freigabe des
Fernmeldewesens nicht ermittelt ist, MUST die Seite keine Daten zeigen.

#### Scenario: Einstieg aus der Stabseite
- **WHEN** eine Person mit Leserecht auf Stab und Fernmeldewesen in der Zeile S6 auf
  „Kommunikationsplan“ tippt
- **THEN** öffnet sich der Kommunikationsplan unter seiner Adresse im Modul Fernmeldewesen, und das
  Modul ist in der Navigation als aktiv markiert

#### Scenario: Altes Lesezeichen
- **WHEN** eine Person `/einsaetze/:id/stab/kommunikationsplan` aufruft
- **THEN** landet sie auf `/einsaetze/:id/fernmeldewesen/kommunikationsplan`

#### Scenario: Altes Lesezeichen bei ausgeblendetem Stab
- **WHEN** der Stab im Einsatz ausgeblendet ist und eine Person `/einsaetze/:id/stab/kommunikationsplan`
  aufruft
- **THEN** landet sie im Kommunikationsplan des Moduls Fernmeldewesen, nicht beim Hinweis „Stab
  ausgeblendet“

#### Scenario: Freigabe nicht ermittelbar
- **WHEN** der Abruf der Modulfreigaben scheitert
- **THEN** zeigt die Seite einen Fehler mit Wiederholen und keine Verbindungen

#### Scenario: Stab gesperrt
- **WHEN** der Stab für die Person gesperrt oder im Einsatz ausgeblendet ist und das Fernmeldewesen
  frei
- **THEN** zeigt der Kommunikationsplan alle Stellen und Verbindungen, und eine Person mit
  Schreibrecht kann sie anlegen, ändern und entfernen

#### Scenario: Fernmeldewesen gesperrt
- **WHEN** das Modul Fernmeldewesen für die Person ausgeblendet oder für ihre Rolle gesperrt ist
- **THEN** zeigt der Rahmen den einheitlichen Hinweis für „Fernmeldewesen“, und der Server lehnt
  das Lesen unter `…/stab/kommunikationsplan` mit 403 ab, auch wenn der Stab frei ist

### Requirement: Rechteweiche je Quelle
Der Kommunikationsplan SHALL Abschnitte, Einheiten, Besetzung des Stabs und die gepflegten Stellen
einzeln laden. Die Besetzung des Stabs SHALL er nur abrufen, wenn der Stab für die Person frei ist.
Ist eine Quelle gesperrt (403 oder Modul nicht frei) oder nicht geladen, MUST die Seite das an ihrer
Gruppe bzw. Zeile mit Grund sagen („nicht freigegeben“, „nicht geladen“) und die übrigen Gruppen
weiter zeigen. Eine fehlende Quelle MUST NOT als leere Gruppe erscheinen.

#### Scenario: Einheiten gesperrt
- **WHEN** die Einheitenliste mit 403 abgelehnt wird
- **THEN** steht bei der Gruppe Einheiten „nicht freigegeben“, und die Gruppen Einsatzleitung und
  Stab, Abschnitte und externe Stellen bleiben vollständig

#### Scenario: Stab nicht frei
- **WHEN** das Fernmeldewesen frei ist, der Stab aber ausgeblendet oder gesperrt
- **THEN** zeigen die Zeilen der Führungsfunktionen ihre Verbindungen, ihr Nebentext zur Besetzung
  lautet „—“ mit dem Grund „Stab nicht freigegeben“, und es geht keine Anfrage an den Stab

### Requirement: Live und ohne Schreibrecht nur lesend
Änderungen an Stellen und Verbindungen SHALL bei anderen geöffneten Kommunikationsplänen desselben
Einsatzes ohne Neuladen erscheinen. Ohne Schreibrecht auf das Fernmeldewesen MUST die Seite keine
Bearbeitungsmöglichkeit zeigen, und der Server MUST jede Änderung mit 403 ablehnen. Ein Ändern
erzeugt keinen ETB-Eintrag.

#### Scenario: Beobachter
- **WHEN** eine Person mit Leserecht, aber ohne Schreibrecht auf das Fernmeldewesen den
  Kommunikationsplan öffnet
- **THEN** sieht sie alle Verbindungen, aber keinen Knopf zum Anlegen, Ändern oder Entfernen

#### Scenario: Zweite Person sieht die Änderung
- **WHEN** zwei Personen den Kommunikationsplan geöffnet haben und eine eine Verbindung anlegt
- **THEN** erscheint die Verbindung bei der anderen ohne Neuladen

#### Scenario: Stab-Leser ohne Fernmeldewesen
- **WHEN** eine Person den Stab lesen darf, das Fernmeldewesen aber nicht, und eine andere eine
  Verbindung anlegt
- **THEN** erhält die erste Person dazu kein Live-Ereignis

### Requirement: Gepflegte Stellen aus Funktionskatalog oder extern
Personen mit Schreibrecht auf das Fernmeldewesen SHALL Stellen anlegen, umbenennen und entfernen können. Eine
Stelle ist entweder eine Führungsfunktion aus dem Katalog oder eine externe Stelle der Art
Leitstelle, Behörde, Verbindungsperson oder sonstige. Eine Führungsfunktion MUST je Einsatz
höchstens einmal vorkommen; Führungshilfspersonal und Fachberater MUST eine Bezeichnung tragen und
dürfen mit verschiedenen Bezeichnungen mehrfach vorkommen. Eine externe Stelle MUST eine
Bezeichnung tragen.

#### Scenario: Unbekannter Funktionscode
- **WHEN** eine Stelle mit dem Funktionscode `s9` angelegt werden soll
- **THEN** antwortet der Server mit 400, und nichts wird gespeichert

#### Scenario: Fachberater ohne Bezeichnung
- **WHEN** eine Stelle „Fachberater“ ohne Bezeichnung angelegt werden soll
- **THEN** antwortet der Server mit 422

#### Scenario: Doppelte Funktion
- **WHEN** im Einsatz schon eine Stelle S3 besteht und eine zweite angelegt werden soll
- **THEN** antwortet der Server mit 409, und die bestehende Stelle bleibt unverändert

#### Scenario: Externe Stelle ohne Bezeichnung
- **WHEN** eine Stelle der Art Leitstelle mit leerer Bezeichnung angelegt werden soll
- **THEN** antwortet der Server mit 400

#### Scenario: S7 ausgeschaltet
- **WHEN** S7 in der Organisation ausgeschaltet ist und eine Stelle S7 angelegt werden soll
- **THEN** antwortet der Server mit 422

### Requirement: Verbindungen je Stelle
Eine gepflegte Stelle SHALL beliebig viele Verbindungen tragen, in der Reihenfolge ihrer Anlage.
Jede Verbindung hat ein Mittel aus der Liste Festnetz, Mobil, Fax, E-Mail, Messenger, Melder,
sonstiges, einen Wert (Rufnummer, Adresse oder Beschreibung, Pflicht, höchstens 200 Zeichen) und
einen optionalen Hinweis (höchstens 200 Zeichen). Personen mit Schreibrecht auf das Fernmeldewesen SHALL
Verbindungen anlegen, ändern und entfernen können.

#### Scenario: Zwei Verbindungen einer Stelle
- **WHEN** für die Leitstelle „Festnetz 0421 1234“ und danach „Fax 0421 1235“ erfasst werden
- **THEN** zeigt die Zeile der Leitstelle beide Verbindungen in dieser Reihenfolge

#### Scenario: Unbekanntes Mittel
- **WHEN** eine Verbindung mit dem Mittel `brieftaube` angelegt werden soll
- **THEN** antwortet der Server mit 400

#### Scenario: Leerer Wert
- **WHEN** eine Verbindung ohne Wert angelegt werden soll
- **THEN** antwortet der Server mit 400, und nichts wird gespeichert
