# Spec Delta

## ADDED Requirements

### Requirement: Externe Stellen tragen Sprechgruppen
Eine externe Stelle (Leitstelle, Behörde, Verbindungsperson, sonstige) SHALL Sprechgruppen des
Katalogs oder des Einsatzes tragen können, je mit Status bestehend oder geplant. Eine
Führungsfunktion MUST keine Sprechgruppe tragen. Der Kommunikationsplan SHALL die Sprechgruppen
einer externen Stelle als Nebentext ihrer Zeile zeigen; bearbeitet werden sie in der
Fernmeldeskizze.

#### Scenario: Leitstelle mit Kanal
- **WHEN** der Leitstelle „ILS Musterhausen“ die Sprechgruppe „TMO SL AS“ zugeordnet ist
- **THEN** zeigt ihre Zeile im Kommunikationsplan „TMO SL AS“ als Nebentext

#### Scenario: Funktion mit Sprechgruppe
- **WHEN** der Stelle S2 eine Sprechgruppe zugeordnet werden soll
- **THEN** antwortet der Server mit 422, und nichts wird gespeichert

#### Scenario: Fremde Sprechgruppe
- **WHEN** einer Stelle die einsatzlokale Sprechgruppe eines anderen Einsatzes zugeordnet werden
  soll
- **THEN** antwortet der Server mit 404 oder 422, und nichts wird gespeichert

## MODIFIED Requirements

### Requirement: Entfernen einer Stelle mit Verbindungen braucht eine zweite Handlung
Das Entfernen einer Stelle SHALL ihre Verbindungen, ihre Sprechgruppen-Zuordnungen und ihre
Verbindungen in der Fernmeldeskizze mit entfernen. Trägt die Stelle mindestens eines davon, MUST
die Oberfläche das Entfernen erst nach einer Bestätigung ausführen, die die Zahl der betroffenen
Verbindungen, Sprechgruppen und Skizzen-Verbindungen nennt.

#### Scenario: Stelle mit Verbindungen entfernen
- **WHEN** eine Person die Stelle „Polizei PI Nord“ mit zwei Verbindungen entfernen will
- **THEN** fragt die Oberfläche nach, nennt zwei Verbindungen, und erst nach der Bestätigung sind
  Stelle und Verbindungen weg

#### Scenario: Stelle mit Kanal und Skizzen-Verbindung entfernen
- **WHEN** eine Person die Leitstelle mit einer Sprechgruppe und einer Datenverbindung in der Skizze
  entfernen will
- **THEN** nennt die Rückfrage eine Sprechgruppe und eine Skizzen-Verbindung, und nach der
  Bestätigung sind Stelle, Zuordnung und Skizzen-Verbindung weg

### Requirement: Lücke „Leitstelle“
Trägt keine Stelle der Art Leitstelle eine Verbindung im Kommunikationsplan, eine Sprechgruppe oder
eine Verbindung in der Fernmeldeskizze, SHALL der Kommunikationsplan im ersten Bild den Hinweis
„Leitstelle: keine Verbindung erfasst“ zeigen, bei 1366 × 768 px mit offenem Modulpanel. Ist die
Liste der gepflegten Stellen nicht geladen, MUST statt des Hinweises „—“ mit Grund stehen. Fehlen
nur die Daten der Fernmeldeskizze, MUST der Hinweis aus den übrigen Angaben entstehen, wenn diese
schon eine Verbindung belegen, sonst „—“ mit Grund.

#### Scenario: Keine Leitstelle
- **WHEN** ein Einsatz nur Verbindungen für S2 und eine Behörde trägt
- **THEN** zeigt die Seite oberhalb der Tabelle „Leitstelle: keine Verbindung erfasst“

#### Scenario: Leitstelle erfasst
- **WHEN** die Leitstelle eine Verbindung trägt
- **THEN** fehlt der Hinweis

#### Scenario: Leitstelle nur über Funk
- **WHEN** die Leitstelle keine Verbindung im Kommunikationsplan, aber die Sprechgruppe
  „TMO SL AS“ trägt
- **THEN** fehlt der Hinweis
