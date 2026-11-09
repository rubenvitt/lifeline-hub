# Spec Delta

## MODIFIED Requirements

### Requirement: Eigene Adresse im Modul Fernmeldewesen
Der Kommunikationsplan SHALL unter `/einsaetze/:id/fernmeldewesen/kommunikationsplan` als
Lesezeichen tauglich erreichbar sein, als Reiter „Kommunikationsplan“ des Moduls Fernmeldewesen und
mit diesem Modul als aktiv in der Navigation. Er SHALL Sichtbarkeit und Sperre des Moduls
Fernmeldewesen erben; den Fall ohne Zugriff fängt der Einsatzrahmen ab (Capability
`modul-freigabe`). Die alte Adresse `/einsaetze/:id/stab/kommunikationsplan` SHALL auf die neue
umleiten. Solange die Freigabe des Fernmeldewesens nicht ermittelt ist, MUST die Seite keine Daten
zeigen.

#### Scenario: Einstieg aus der Stabseite
- **WHEN** eine Person mit Leserecht auf das Fernmeldewesen im Modul auf den Reiter
  „Kommunikationsplan“ tippt
- **THEN** öffnet sich der Kommunikationsplan unter seiner Adresse im Modul Fernmeldewesen, und das
  Modul ist in der Navigation als aktiv markiert

#### Scenario: Altes Lesezeichen
- **WHEN** eine Person `/einsaetze/:id/stab/kommunikationsplan` aufruft
- **THEN** landet sie auf `/einsaetze/:id/fernmeldewesen/kommunikationsplan`

#### Scenario: Altes Lesezeichen bei ausgeblendetem Stab
- **WHEN** eine Person mit Freigabe des Fernmeldewesens `/einsaetze/:id/stab/kommunikationsplan`
  aufruft
- **THEN** landet sie im Kommunikationsplan des Moduls Fernmeldewesen und nicht auf der Seite des
  Einsatzes

#### Scenario: Freigabe nicht ermittelbar
- **WHEN** der Abruf der Modulfreigaben scheitert
- **THEN** zeigt die Seite einen Fehler mit Wiederholen und keine Verbindungen

#### Scenario: Stab gesperrt
- **WHEN** das Fernmeldewesen für die Person frei ist
- **THEN** zeigt der Kommunikationsplan alle Stellen und Verbindungen, und eine Person mit
  Schreibrecht kann sie anlegen, ändern und entfernen

#### Scenario: Fernmeldewesen gesperrt
- **WHEN** das Modul Fernmeldewesen für die Person ausgeblendet oder für ihre Rolle gesperrt ist
- **THEN** zeigt der Rahmen den einheitlichen Hinweis für „Fernmeldewesen“, und der Server lehnt
  das Lesen unter `…/stab/kommunikationsplan` mit 403 ab

### Requirement: Rechteweiche je Quelle
Der Kommunikationsplan SHALL Abschnitte, Einheiten, die Mitglieder des Einsatzes und die gepflegten
Stellen einzeln laden. Die Mitglieder SHALL er ohne eigenes Modulrecht abrufen. Ist eine Quelle
gesperrt (403 oder Modul nicht frei) oder nicht geladen, MUST die Seite das an ihrer Gruppe bzw.
Zeile mit Grund sagen („nicht freigegeben“, „nicht geladen“) und die übrigen Gruppen weiter zeigen.
Eine fehlende Quelle MUST NOT als leere Gruppe erscheinen.

#### Scenario: Einheiten gesperrt
- **WHEN** die Einheitenliste mit 403 abgelehnt wird
- **THEN** steht bei der Gruppe Einheiten „nicht freigegeben“, und die Gruppen Einsatzleitung und
  Stab, Abschnitte und externe Stellen bleiben vollständig

#### Scenario: Stab nicht frei
- **WHEN** das Fernmeldewesen frei ist, der Abruf der Mitglieder aber scheitert
- **THEN** zeigen die Zeilen der Führungsfunktionen ihre Verbindungen, und ihr Nebentext zur
  Besetzung lautet „—“ mit dem Grund „nicht geladen“

### Requirement: Verbindung an der Stelle, Besetzung nur als Nebentext
Eine Verbindung SHALL der Stelle gehören, nicht einer Person. Die Zeile einer Führungsfunktion
S1–S6 SHALL als Nebentext die Namen der Mitglieder zeigen, die diese Funktion in ihrer
Mitgliedschaft tragen (Spec `fuehrungsfunktionen`, „Mehrere Mitglieder mit derselben
Führungsfunktion“). Der Kommunikationsplan MUST NOT Kontaktangaben aus dem Einsatzpersonal
übernehmen oder vorschlagen. Eine Zeile für die eigene Führungsstelle MUST NOT aus anderen Daten
vermutet werden.

#### Scenario: Besetzung wechselt
- **WHEN** S2 eine Verbindung „Mobil 0170 111“ trägt und die Führungsfunktion S2 von einem Mitglied
  auf ein anderes wechselt
- **THEN** bleibt die Verbindung an S2 stehen, und der Nebentext nennt das neue Mitglied

#### Scenario: Zwei Mitglieder mit S2
- **WHEN** Schulz und Müller als Mitglieder beide S2 tragen
- **THEN** lautet der Nebentext der Zeile S2 „Müller, Schulz“

#### Scenario: Telefon am Personal
- **WHEN** die Person, die S2 besetzt, im Einsatzpersonal eine Telefonnummer trägt
- **THEN** erscheint diese Nummer nicht im Kommunikationsplan

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
- **WHEN** eine Person den Einsatz lesen darf, das Fernmeldewesen aber nicht, und eine andere eine
  Verbindung anlegt
- **THEN** erhält die erste Person dazu kein Live-Ereignis
