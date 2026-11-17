# Spec Delta

## MODIFIED Requirements

### Requirement: Einsatzwechsler zeigt den eigenen Einsatz und keine Verwaltung

Der Einsatzwechsler SHALL den aktuellen Einsatz als gewählt markieren, auch wenn er abgeschlossen
ist. Ein Klick darauf SHALL
das Menü schließen, ohne die Seite zu wechseln. Jeder Einsatz SHALL eine Nebenzeile mit
Einsatzart, Einsatznummer und Ort tragen, soweit sie vorliegen; bei einer Übung entfällt die
Einsatzart, weil die Übungsmarke sie schon nennt, und fehlt jede Nummer, steht an ihrer Stelle
das Beginndatum. Der Wechsler SHALL keinen Eintrag zur Verwaltung oder zu den Stammdaten führen.

#### Scenario: Klick auf den eigenen Einsatz

- **WHEN** eine Person im ETB den Wechsler öffnet und ihren eigenen Einsatz wählt
- **THEN** bleibt sie im ETB

#### Scenario: Gleich benannte Einsätze

- **WHEN** zwei aktive Einsätze „Stadtfest“ heißen, einer als Sanitätsdienst mit Nummer
  E-2026-0431 am Ort „Markt“, einer als Übung ohne Nummer, begonnen am 14.11.
- **THEN** zeigt der Wechsler beim ersten „Sanitätsdienst · E-2026-0431 · Markt“ und beim zweiten
  die Marke „ÜBUNG“ mit der Nebenzeile „seit 14.11.“

## ADDED Requirements

### Requirement: Einsatzwechsel bleibt im Modul

Wählt eine Person im Einsatzwechsler oder im Einsatzwechsel der Sprungpalette einen anderen
Einsatz, SHALL sie auf der Startseite desselben Moduls im Ziel-Einsatz ankommen, sofern das Modul
dort für sie freigegeben ist. Ist es das nicht, MUST sie ohne Hinweis im Standardmodul des Ziels
ankommen. Detail, Auswahl und Filter des vorigen Einsatzes MUST NOT mitgenommen werden.

#### Scenario: Fahrzeuge bleibt Fahrzeuge

- **WHEN** eine Person in Einsatz 7 die Fahrzeuge mit geöffnetem Fahrzeug 3 ansieht und im
  Wechsler Einsatz 8 wählt
- **THEN** öffnet sich die Fahrzeugliste von Einsatz 8 ohne geöffnetes Fahrzeug

#### Scenario: Modul im Ziel ausgeblendet

- **WHEN** eine Person aus den Fahrzeugen in einen Einsatz wechselt, dessen Vorlage die Fahrzeuge
  ausblendet
- **THEN** öffnet sich dessen Standardmodul, ohne Sperrseite

#### Scenario: Palette im neuen Tab

- **WHEN** eine Person in den Fahrzeugen die Sprungpalette öffnet, den Einsatzwechsel zu Einsatz 8
  markiert und Strg+↵ drückt
- **THEN** öffnet sich im neuen Tab die Fahrzeugliste von Einsatz 8
