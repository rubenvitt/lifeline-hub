# Spec Delta

## Purpose

Katalog- und Verwaltungstabellen bekommen einen umschaltbaren Spaltensatz mit einem Zähler
ausgeblendeter Spalten (Kriterium 14 der Bedien-Leitlinie). Handauswahl und
breitenabhängiges Wegfallen zählen dabei in einen gemeinsamen Zähler, damit er nie lügt.
Zuerst gilt das für die Offline-Karten- und die Online-Quellen-Verwaltung.

## ADDED Requirements

### Requirement: Spaltenschalter mit Zähler an den Kartenverwaltungen
Die Offline-Karten-Verwaltung und die Online-Quellen-Verwaltung SHALL je einen
Spaltenschalter tragen. Er steht in der Werkzeugzeile über der Tabelle. Sind keine Spalten
ausgeblendet, heißt er „Spalten“. Sind n Spalten ausgeblendet, heißt er
„Spalten · n ausgeblendet“. Der Zähler MUST als Text im Namen stehen, nicht als farbiges
Abzeichen. Der zugängliche Name MUST die Tabelle nennen, damit mehrere Schalter unterscheidbar
bleiben.

#### Scenario: Grundzustand auf breitem Schirm
- **WHEN** die Online-Quellen-Verwaltung auf einem Schirm ab der Breite `lg` geöffnet wird und niemand Spalten abgewählt hat
- **THEN** sind alle Spalten sichtbar und der Schalter heißt „Spalten“

#### Scenario: Eine Spalte per Hand abgewählt
- **WHEN** im Schalter der Offline-Karten-Verwaltung „Größe“ abgewählt wird
- **THEN** verschwindet die Spalte „Größe“ aus der Tabelle und der Schalter heißt „Spalten · 1 ausgeblendet“

### Requirement: Ein Zähler für Handauswahl und Breite
Der Zähler SHALL jede nicht gezeigte Spalte genau einmal zählen, egal ob sie per Hand
abgewählt ist, auf der aktuellen Breite wegfällt oder beides. Eine Spalte, die unterhalb
ihrer Breitenschwelle wegfällt, MUST sich im Schalter von Hand wieder einblenden lassen und
MUST dann gezeigt werden.

#### Scenario: Beide Ursachen gemischt
- **WHEN** die Online-Quellen-Verwaltung unterhalb der Breite `lg` steht, dadurch URL und Attribution wegfallen, und zusätzlich „Sortierung“ per Hand abgewählt ist
- **THEN** heißt der Schalter „Spalten · 3 ausgeblendet“

#### Scenario: Doppelt verborgen zählt einmal
- **WHEN** unterhalb von `lg` die ohnehin weggefallene Spalte „Attribution“ zusätzlich per Hand abgewählt wird
- **THEN** steigt der Zähler nicht

#### Scenario: Breitenabhängig weggefallene Spalte von Hand zurückholen
- **WHEN** die Offline-Karten-Verwaltung unterhalb von `lg` steht und „Attribution“ im Schalter angewählt wird
- **THEN** erscheint die Spalte „Attribution“ und der Zähler sinkt um eins

### Requirement: Kennung und Aktionen bleiben stehen
Die erste Spalte (die menschenlesbare Kennung, bei beiden Verwaltungen der Name) SHALL nie
ausblendbar sein, weder per Hand noch per Breite. Sie MUST fixiert bleiben. Die
Aktionsspalte der Administration MUST ebenfalls sichtbar bleiben und erscheint im Schalter
nicht als Wahl.

#### Scenario: Name und Aktionen fehlen im Schalter
- **WHEN** ein System-Admin den Schalter einer Kartenverwaltung öffnet
- **THEN** bietet das Menü weder „Name“ noch „Aktionen“ zum Abwählen an

### Requirement: Keine Auflösung in Karten
Beide Kartenverwaltungen SHALL auf jeder Breite eine Tabelle bleiben. Ein schmaler Schirm
MUST Spalten über Breitenschwelle und Schalter reduzieren und die Tabelle waagerecht in sich
scrollen lassen. Er MUST sie nicht in Karten auflösen.

#### Scenario: Handschirm
- **WHEN** eine Kartenverwaltung bei 390 px Breite geöffnet wird
- **THEN** steht eine Tabelle mit stehender Kopfzeile und fixiertem Namen da, und die Seite selbst scrollt nicht waagerecht

### Requirement: Sortierung, Filter und Suche bleiben erhalten
Das Ausblenden von Spalten SHALL die bestehende Kopfsortierung (Name, Größe, Sortierung), die
Spaltenfilter (Status, Aktiv) und die Freitextsuche der Kartenverwaltungen unverändert
lassen, solange die betroffene Spalte sichtbar ist.

#### Scenario: Aktiv-Filter unverändert
- **WHEN** in der Online-Quellen-Verwaltung der Aktiv-Filter auf „inaktiv“ gesetzt ist
- **THEN** zeigt die Tabelle nur inaktive Quellen, genau wie ohne Schalter

### Requirement: Der Schalter ist über die Kommandopalette erreichbar
Solange eine Kartenverwaltung einen Schalter mit mindestens einer abwählbaren Spalte zeigt,
SHALL die Kommandopalette den Befehl „Spalten“ für diese Tabelle anbieten und damit das
Schaltermenü öffnen. Gibt es nichts abzuwählen, MUST der Befehl fehlen.

#### Scenario: Palette öffnet den Schalter
- **WHEN** der Fokus in der Werkzeugzeile der Offline-Karten-Verwaltung liegt und in der Kommandopalette „Spalten“ gewählt wird
- **THEN** öffnet sich das Schaltermenü dieser Tabelle

### Requirement: Übrige Katalogtabellen unverändert
Katalogtabellen, die den Schalter nicht ausdrücklich einschalten, SHALL weder einen Schalter
noch breitenabhängig wegfallende Spalten zeigen. Alle ihre Spalten MUST sichtbar bleiben.

#### Scenario: Stammdaten-Reiter ohne Schalter
- **WHEN** der Stammdaten-Reiter „Fahrzeuge“ geöffnet wird
- **THEN** gibt es keinen Spaltenschalter, und alle Spalten des Reiters stehen in der Tabelle
