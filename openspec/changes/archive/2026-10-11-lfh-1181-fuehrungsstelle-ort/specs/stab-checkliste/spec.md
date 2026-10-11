# Spec Delta

## MODIFIED Requirements

### Requirement: Sieben feste Punkte mit Quelle
Die Checkliste SHALL genau sieben Punkte in fester Reihenfolge führen: Standort der Führungsstelle
festgelegt, Einweisung durch die Einsatzleitung erhalten, Lageskizze begonnen,
Funkarbeitsplätze eingerichtet, Sprechgruppen zugeteilt, ETB eröffnet, Einsatzbereitschaft an die
Leitstelle gemeldet. Jeder Punkt MUST seine Quelle sichtbar tragen. Die Punkte MUST NOT je
Organisation oder Einsatz konfigurierbar sein, und ein Punkt MUST NOT aus dem Zustand eines anderen
Moduls abgeleitet werden.

#### Scenario: Neuer Einsatz
- **WHEN** eine Person mit Leserecht auf den Stab die Stabseite eines neuen Einsatzes öffnet
- **THEN** zeigt das Paneel „Arbeitsaufnahme“ sieben offene Punkte in dieser Reihenfolge, jeder
  mit Quelle, und den Zähler „0/7 erledigt“

#### Scenario: ETB hat schon Einträge
- **WHEN** im ETB des Einsatzes bereits Einträge stehen, der Punkt „ETB eröffnet“ aber nicht
  abgehakt ist
- **THEN** bleibt der Punkt offen

## ADDED Requirements

### Requirement: Standort der Führungsstelle am ersten Punkt
Der Punkt „Standort der Führungsstelle festgelegt“ SHALL Bezeichnung und Standort der eigenen
Führungsstelle als Wert zeigen, soweit erfasst, und auf ihr Paneel in den Einsatzdaten verweisen.
Ohne Standort MUST dort „Standort nicht erfasst“ stehen. Der Wert MUST NOT den Haken setzen oder
entfernen; der gespeicherte Schlüssel des Punkts bleibt unverändert.

#### Scenario: Standort erfasst, Punkt offen
- **WHEN** die Führungsstelle „ELW 2 Musterstadt“ mit Adresse „Parkplatz Feuerwehrhaus Nord“ erfasst ist und der Punkt nicht abgehakt ist
- **THEN** zeigt der Punkt „ELW 2 Musterstadt · Parkplatz Feuerwehrhaus Nord“ mit Verweis auf die Einsatzdaten und bleibt offen

#### Scenario: Kein Standort
- **WHEN** die Führungsstelle keinen Standort trägt
- **THEN** zeigt der Punkt „Standort nicht erfasst“ mit Verweis auf die Einsatzdaten

#### Scenario: Abruf gesperrt oder gescheitert
- **WHEN** der Abruf der Führungsstelle scheitert
- **THEN** nennt der Punkt den Grund statt „nicht erfasst“, und Haken und Bemerkung bleiben bedienbar
