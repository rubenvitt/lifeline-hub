# Spec Delta

## Purpose

Legt fest, welche Bedienwege die Abkürzungsliste „Zuletzt besucht" der Sprungpalette füllen,
wem die Liste gehört und wie lange ein Eintrag gilt. Gemerkt wird, was jemand gewählt hat,
nicht, wohin er geleitet wurde.

## ADDED Requirements

### Requirement: Aufzeichnung nur an bewusst gewählten Zugängen

Das System SHALL ein Modul nur dann in „Zuletzt besucht" aufnehmen, wenn eine Person es über
einen der folgenden Zugänge gewählt hat: Modul-Panel, Modul-Akkordeon im Navigations-Drawer,
Sprungpalette (Gruppen „Module", „Zuletzt besucht" und Schnellaktionen), ein Ziel auf
Führung · Überblick oder ein Ziel im Lage-Dashboard. Ein Zugang zeichnet nur auf, wenn sein
Ziel in einem Modul des Einsatzes liegt. Die Aufnahme geschieht beim Klick bzw. bei der
Ausführung, nicht beim Anzeigen eines Ziels.

#### Scenario: Kennzahl auf dem Überblick

- **WHEN** eine Person auf Führung · Überblick die Kennzahl „Betroffene" anklickt
- **THEN** steht „Personen" danach als jüngster Eintrag in „Zuletzt besucht"

#### Scenario: Knopf auf dem Überblick

- **WHEN** eine Person auf Führung · Überblick den Kopfknopf „Eintrag" wählt
- **THEN** steht „ETB" danach als jüngster Eintrag in „Zuletzt besucht"

#### Scenario: Paneel-Link im Lage-Dashboard

- **WHEN** eine Person im Lage-Dashboard den Paneel-Link „Gefahren" wählt
- **THEN** steht das Gefahren-Modul danach als jüngster Eintrag in „Zuletzt besucht"

#### Scenario: Schnellaktion der Palette

- **WHEN** eine Person in der Sprungpalette die Schnellaktion „Neuer ETB-Eintrag" ausführt
- **THEN** steht „ETB" danach als jüngster Eintrag in „Zuletzt besucht"

#### Scenario: Ziel ohne Modul

- **WHEN** eine Person auf dem Überblick einem Verweis folgt, der nicht in ein Modul des
  Einsatzes führt (z. B. die Brotkrume „Einsätze")
- **THEN** bleibt „Zuletzt besucht" unverändert

#### Scenario: Anzeigen allein zeichnet nicht auf

- **WHEN** Führung · Überblick oder das Lage-Dashboard geladen wird, ohne dass etwas angeklickt
  wird
- **THEN** bleibt „Zuletzt besucht" unverändert

### Requirement: Ankünfte zeichnen nicht auf

Das System MUST NOT ein Modul in „Zuletzt besucht" aufnehmen, wenn es angesteuert wurde, ohne
dass jemand genau dieses Modul gewählt hat. Das betrifft den Rail-Sprung in das erste Modul
einer Kategorie, den Einsatz-Switcher mit der Weiterleitung auf das Standardmodul, das Öffnen
einer Adresse von außen (Lesezeichen, eingefügter Link, neuer Tab) und Querverweise innerhalb
von Modulinhalten.

#### Scenario: Rail-Sprung

- **WHEN** eine Person in der Rail eine andere Kategorie anklickt und dadurch in deren erstes
  Modul geleitet wird
- **THEN** bleibt „Zuletzt besucht" unverändert, obwohl sich die Seite gewechselt hat

#### Scenario: Einsatzwechsel

- **WHEN** eine Person über den Einsatz-Switcher einen Einsatz öffnet und auf dessen
  Standardmodul weitergeleitet wird
- **THEN** enthält „Zuletzt besucht" dieses Standardmodul nicht

#### Scenario: Adresse von außen

- **WHEN** eine Modulseite direkt über ihre Adresse geladen wird
- **THEN** bleibt „Zuletzt besucht" unverändert

### Requirement: Liste je Benutzer und Einsatz

Das System SHALL „Zuletzt besucht" getrennt je angemeldetem Benutzer und je Einsatz führen. Ein
Benutzer MUST NOT die Einträge eines anderen Benutzers sehen, auch nicht im selben Browser.

#### Scenario: Schichtwechsel am gemeinsamen Rechner

- **WHEN** Benutzer A im Einsatz 7 die Module ETB und Personen gewählt hat und danach Benutzer B
  im selben Browser Einsatz 7 öffnet
- **THEN** zeigt die Sprungpalette für B keine Gruppe „Zuletzt besucht"

#### Scenario: Einsatzwechsel

- **WHEN** eine Person in Einsatz 7 das ETB gewählt hat und Einsatz 8 öffnet
- **THEN** enthält „Zuletzt besucht" in Einsatz 8 das ETB nicht

### Requirement: Einträge verfallen nach zwölf Stunden

Das System SHALL einen Eintrag in „Zuletzt besucht" nur anzeigen, solange seine letzte Wahl
höchstens zwölf Stunden zurückliegt. Eine erneute Wahl desselben Moduls MUST die Frist neu
beginnen lassen und den Eintrag nach vorn stellen, ohne ihn zu verdoppeln.

#### Scenario: Abgelaufener Eintrag

- **WHEN** das ETB zuletzt vor 12 Stunden und einer Minute gewählt wurde
- **THEN** erscheint es nicht in „Zuletzt besucht"

#### Scenario: Frischer Eintrag

- **WHEN** das ETB zuletzt vor 11 Stunden und 59 Minuten gewählt wurde
- **THEN** erscheint es in „Zuletzt besucht"

#### Scenario: Erneute Wahl erneuert die Frist

- **WHEN** das ETB vor 11 Stunden gewählt wurde und jetzt erneut gewählt wird
- **THEN** steht es einmal und vorn in der Liste und bleibt weitere zwölf Stunden sichtbar

### Requirement: Liste bleibt kurz

Das System SHALL höchstens drei Einträge in „Zuletzt besucht" führen, den jüngsten zuerst.
Unlesbare oder fremdartige gespeicherte Werte MUST als leere Liste gelten, statt die Navigation
zu stören.

#### Scenario: Vierte Wahl verdrängt die älteste

- **WHEN** nacheinander vier verschiedene Module gewählt werden
- **THEN** zeigt „Zuletzt besucht" die letzten drei, jüngstes zuerst

#### Scenario: Speicherstand im alten Format

- **WHEN** im Browser noch ein Stand im Format vor diesem Change liegt
- **THEN** ist „Zuletzt besucht" leer und die Navigation arbeitet normal
