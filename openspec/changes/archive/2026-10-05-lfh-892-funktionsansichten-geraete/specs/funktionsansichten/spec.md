# Spec Delta

## Purpose

Legt fest, welche Funktionsansichten ein gekoppeltes Gerät haben kann, was jede davon lesen und
schreiben darf und wie der Server diese Schranke durchsetzt.

## ADDED Requirements

### Requirement: Katalog der Funktionsansichten

Das System SHALL genau diese Funktionsansichten kennen: `uhs-tablet`, `uhs-laptop` und
`lagemonitor`. Die beiden UHS-Ansichten MUST an genau eine UHS des Einsatzes gebunden sein, der
Lagemonitor an keine Stelle. Ein unbekannter Ansichtswert MUST beim Anlegen einer Kopplung 400
sein.

#### Scenario: Unbekannte Ansicht

- **WHEN** die Einsatzleitung eine Kopplung mit der Ansicht `betreuungsstelle` anlegt
- **THEN** antwortet der Server mit 400

#### Scenario: UHS aus fremdem Einsatz

- **WHEN** die Einsatzleitung eine UHS-Ansicht an eine UHS eines anderen Einsatzes binden will
- **THEN** antwortet der Server mit 404

### Requirement: Scope-Matrix

Jede Ansicht SHALL genau die folgenden Rechte haben, je Modul getrennt nach Lesen (L) und
Schreiben (S). Was die Tabelle nicht nennt, MUST verboten sein. „Eigene UHS“ heißt die UHS der
Kopplung.

| Modul / Bereich | UHS-Tablet | UHS-Laptop | Lagemonitor |
| --- | --- | --- | --- |
| Einsatzkopf, Modulfreigaben, Modulzähler, Live-Kanal | L | L | L |
| `unfallhilfsstellen`: eigene UHS mit Plätzen und Belegung | L | L | — |
| `unfallhilfsstellen`: Belegung (Eintritt, Wechsel in der eigenen UHS, Austritt), Platzverfügbarkeit | S | S | — |
| `unfallhilfsstellen`: Plätze anlegen, ändern, stornieren; Stammdaten der eigenen UHS; Anhänge der eigenen UHS | — | L/S | — |
| `unfallhilfsstellen`: UHS anlegen, Status wechseln, stornieren | — | — | — |
| `personen`: Personen der eigenen UHS | L | L | — |
| `personen`: Aufnahme in die eigene UHS, Stammdaten, Sichtung, Verbleib, Notizen | S | S | — |
| `personen`: Export, Druck, Abgleich, Anhänge | — | — | — |
| `material`: Material der eigenen UHS | — | L | — |
| `meldungen`: Meldung an die Einsatzleitung anlegen, eigene Meldungen lesen | — | L/S | — |
| Lagemonitor-Lagebild (verdichtete Zahlen) | — | — | L |
| `lagekarte`, `gefahrenzonen`, `einsatzabschnitte` ohne personenbezogene Ebenen | — | — | L |
| alle übrigen Module, Einstellungen, Verwaltung | — | — | — |

Der Lagemonitor MUST NOT schreiben dürfen, in keinem Modul.

#### Scenario: Tablet liest das ETB nicht

- **WHEN** ein UHS-Tablet das ETB seines Einsatzes abruft
- **THEN** antwortet der Server mit 403

#### Scenario: Tablet bearbeitet den Grundriss nicht

- **WHEN** ein UHS-Tablet in seiner UHS einen Platz anlegt
- **THEN** antwortet der Server mit 403

#### Scenario: Laptop bearbeitet den Grundriss

- **WHEN** ein UHS-Laptop in seiner UHS einen Platz anlegt
- **THEN** legt der Server den Platz an

#### Scenario: Laptop wechselt den UHS-Status nicht

- **WHEN** ein UHS-Laptop seine UHS auf „aufgelöst“ setzen will
- **THEN** antwortet der Server mit 403

#### Scenario: Lagemonitor schreibt nichts

- **WHEN** ein Lagemonitor irgendeine schreibende Anfrage an eine Einsatzroute schickt
- **THEN** antwortet der Server mit 403

#### Scenario: Lagemonitor liest keine Personen

- **WHEN** ein Lagemonitor die Personenliste oder eine UHS-Detailseite abruft
- **THEN** antwortet der Server mit 403

### Requirement: Stellenbindung

Ein Gerät mit stellengebundener Ansicht SHALL nur Daten der eigenen UHS sehen und schreiben.
Eine fremde UHS MUST 404 sein. Eine Person MUST für das Gerät sichtbar sein, wenn sie mindestens
eine Belegung in der eigenen UHS hat, auch nach ihrem Austritt.

#### Scenario: Fremde UHS

- **WHEN** das Tablet der UHS Nord die UHS Süd abruft
- **THEN** antwortet der Server mit 404

#### Scenario: UHS-Liste

- **WHEN** das Tablet der UHS Nord die UHS-Liste abruft
- **THEN** enthält sie nur die UHS Nord

#### Scenario: Person der anderen UHS

- **WHEN** das Tablet der UHS Nord eine Person abruft, die nie in der UHS Nord war
- **THEN** antwortet der Server mit 404

#### Scenario: Verbleib nach Austritt

- **WHEN** eine Person die UHS Nord verlassen hat
- **AND** das Tablet der UHS Nord ihren Verbleib einträgt
- **THEN** speichert der Server den Verbleib

#### Scenario: Belegung in fremde UHS

- **WHEN** das Tablet der UHS Nord eine Person in die UHS Süd buchen will
- **THEN** antwortet der Server mit 403

### Requirement: Aufnahme bucht in die eigene UHS

Legt ein UHS-Gerät eine Person an, SHALL der Server sie im selben Schritt in den Eingang der
eigenen UHS buchen. Beides MUST gemeinsam gelingen oder gemeinsam scheitern.

#### Scenario: Aufnahme am Tablet

- **WHEN** das Tablet der UHS Nord eine Person aufnimmt
- **THEN** steht die Person im Eingang der UHS Nord
- **AND** erscheint sie in der Patientenliste des Tablets

### Requirement: Schranke liegt auf dem Server

Der Server SHALL die Ansicht bei jeder Anfrage einer Gerätesitzung prüfen, unabhängig davon,
was die Oberfläche anbietet. Eine Route, die die Ansicht nicht ausdrücklich zulässt, MUST für
ein Gerät 403 sein; das gilt auch für jede künftig hinzukommende Route. Außerhalb des Einsatzes
MUST eine Gerätesitzung nur Anmeldestatus, Abmelden, Kartengrundlagen und das Branding der
Organisation erreichen.

#### Scenario: Route außerhalb des Einsatzes

- **WHEN** ein gekoppeltes Gerät die Benutzerverwaltung oder die Stammdaten abruft
- **THEN** antwortet der Server mit 403

#### Scenario: Anderer Einsatz

- **WHEN** ein gekoppeltes Gerät einen anderen Einsatz als seinen eigenen abruft
- **THEN** antwortet der Server mit 404

#### Scenario: Neue Route ohne Zulassung

- **WHEN** eine neue Einsatzroute hinzukommt, die keine Ansicht zulässt
- **THEN** antwortet sie einem Gerät mit 403, ohne dass die Ansicht geändert wurde

### Requirement: Modulfreigabe gilt zusätzlich

Die Modulfreigabe des Einsatzes und der Organisation SHALL für ein Gerät zusätzlich zur Ansicht
gelten. Ein Gerät MUST behandelt werden wie ein Mitglied ohne System- und Org-Rolle. Beim Anlegen
einer Kopplung MUST die Maske sagen, welche Module der Ansicht gesperrt sind.

#### Scenario: Org sperrt Personen für Mitglieder

- **WHEN** die Organisation das Modul Personen nur für Führungskräfte freigibt
- **AND** die Einsatzleitung ein UHS-Tablet koppeln will
- **THEN** nennt die Maske das Modul Personen als gesperrt

### Requirement: Live-Kanal folgt der Ansicht

Der Live-Kanal eines Geräts SHALL nur Ereignisse der Module liefern, die seine Ansicht lesen
darf.

#### Scenario: Kein ETB-Ereignis am Tablet

- **WHEN** im Einsatz ein ETB-Eintrag entsteht
- **THEN** erhält ein UHS-Tablet dazu kein Live-Ereignis
