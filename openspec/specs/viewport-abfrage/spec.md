# viewport-abfrage Specification

## Purpose
Die Viewport-Abfrage beantwortet Breiten- und Zeigerfragen des Frontends mit den Schwellen von
antd und hält dafür je Seite einen festen Satz Medienabfrage-Hörer, gleich wie viele Komponenten
fragen.

## Requirements

### Requirement: Ein Hörersatz für alle Fragenden
Die Viewport-Abfrage SHALL für jede Breitenstufe und für die Zeigerart höchstens einen
Medienabfrage-Hörer registrieren, solange mindestens eine Komponente fragt, und alle Hörer abmelden,
sobald keine mehr fragt. Die Zahl der Hörer MUST unabhängig von der Zahl der fragenden Komponenten
sein.

#### Scenario: Hundert Zeitachseneinträge
- **WHEN** 100 Zeitachseneinträge gleichzeitig gerendert sind
- **THEN** sind höchstens 8 Medienabfrage-Hörer registriert

#### Scenario: Alle Fragenden weg
- **WHEN** die letzte fragende Komponente aushängt
- **THEN** ist kein Medienabfrage-Hörer der Viewport-Abfrage mehr registriert

### Requirement: Antworten unverändert
Die Viewport-Abfrage SHALL dieselben Antworten geben wie bisher: Schwellen aus antd, `xs` nicht
fragbar, `(pointer: coarse)` als Zeigersignal, und eine Änderung von Breite oder Zeigerart
erreicht jede fragende Komponente.

#### Scenario: Fensterwechsel zur Laufzeit
- **WHEN** das Fenster von 1180 auf 820 px wechselt
- **THEN** melden alle fragenden Komponenten „schmaler als lg“ und „mindestens md“

#### Scenario: Zeigerwechsel
- **WHEN** der primäre Zeiger von fein auf grob wechselt
- **THEN** melden alle fragenden Komponenten Berührung
