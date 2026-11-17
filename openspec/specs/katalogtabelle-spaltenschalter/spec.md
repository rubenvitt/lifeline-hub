# katalogtabelle-spaltenschalter Specification

## Purpose
Katalog- und Verwaltungstabellen bekommen einen umschaltbaren Spaltensatz mit einem Zähler
ausgeblendeter Spalten (Kriterium 14 der Bedien-Leitlinie). Handauswahl und
breitenabhängiges Wegfallen zählen dabei in einen gemeinsamen Zähler, damit er nie lügt.
Zuerst gilt das für die Offline-Karten- und die Online-Quellen-Verwaltung.

## Requirements

### Requirement: Spaltenschalter mit Zähler an den Kartenverwaltungen
Die Offline-Karten-Verwaltung und die Online-Quellen-Verwaltung SHALL je einen
Spaltenschalter tragen. Er steht in der Werkzeugzeile über der Tabelle. Wie er heißt, regelt
„Der Zähler erscheint erst nach eigener Wahl“. Der Zähler MUST als Text im Namen stehen, nicht
als farbiges Abzeichen. Der zugängliche Name MUST die Tabelle nennen, damit mehrere Schalter
unterscheidbar bleiben.

#### Scenario: Grundzustand auf breitem Schirm
- **WHEN** die Online-Quellen-Verwaltung auf einem Schirm ab der Breite `lg` geöffnet wird und niemand Spalten abgewählt hat
- **THEN** sind alle Spalten sichtbar und der Schalter heißt „Spalten“

#### Scenario: Eine Spalte per Hand abgewählt
- **WHEN** im Schalter der Offline-Karten-Verwaltung „Größe“ abgewählt wird
- **THEN** verschwindet die Spalte „Größe“ aus der Tabelle und der Schalter heißt „Spalten · 1 ausgeblendet“

### Requirement: Ein Zähler für Handauswahl und Breite
Der Zähler SHALL jede nicht gezeigte Spalte genau einmal zählen, egal ob sie per Hand
abgewählt ist, auf der aktuellen Breite wegfällt, voreingestellt ausgeblendet ist oder
mehreres davon. Eine Spalte, die unterhalb ihrer Breitenschwelle wegfällt, MUST sich im Schalter
von Hand wieder einblenden lassen und MUST dann gezeigt werden. Ob der Zähler im Namen steht,
regelt „Der Zähler erscheint erst nach eigener Wahl“.

#### Scenario: Beide Ursachen gemischt
- **WHEN** die Online-Quellen-Verwaltung unterhalb der Breite `lg` steht, dadurch URL und Attribution wegfallen, und zusätzlich „Sortierung“ per Hand abgewählt ist
- **THEN** heißt der Schalter „Spalten · 3 ausgeblendet“

#### Scenario: Doppelt verborgen zählt einmal
- **WHEN** „URL“ ab der Breite `lg` per Hand abgewählt ist und das Fenster danach unter `lg` fällt, sodass „URL“ zusätzlich breitenbedingt wegfiele
- **THEN** zählt „URL“ weiterhin einmal, und der Schalter heißt „Spalten · 2 ausgeblendet“ (URL und Attribution), nicht „· 3“

#### Scenario: Breitenabhängig weggefallene Spalte von Hand zurückholen
- **WHEN** die Offline-Karten-Verwaltung unterhalb von `lg` steht und „Attribution“ im Schalter angewählt wird
- **THEN** erscheint die Spalte „Attribution“, und der Schalter nennt die übrigen verborgenen Spalten

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

### Requirement: Spaltenwahl am Gerät gemerkt

Hält die Seite ein Listengedächtnis (`useListenGedaechtnis`), SHALL die Handwahl des
Spaltenschalters (ab- und zurückgewählte Spalten) je Seite am Gerät gemerkt werden und beim
nächsten Öffnen gelten, einsatzübergreifend. Unbekannte Spalten im Speicher MUST verworfen
werden.

#### Scenario: Wiederkehr auf die Schadenliste
- **WHEN** in der Schadenliste „Status“ abgewählt und die Seite später erneut geöffnet wird
- **THEN** bleibt „Status“ ausgeblendet, und der Schalter zählt sie

### Requirement: Der Zähler erscheint erst nach eigener Wahl

Jeder Spaltenschalter SHALL „Spalten“ heißen, solange die Vorgabe gilt, also keine Handwahl von
der Voreinstellung der Seite abweicht; voreingestellt oder nach Breite verborgene Spalten MUST
dann nicht als „ausgeblendet“ gemeldet werden. Weicht die Wahl ab, MUST er
„Spalten · n ausgeblendet“ heißen, n zählt alle verborgenen Spalten. Das Häkchen im Menü MUST die
wirkliche Sichtbarkeit zeigen.

#### Scenario: Fahrzeugliste am Fükw ohne eigene Wahl
- **WHEN** die Fahrzeugliste bei 1440 px geöffnet wird, Typ, Abschnitt, Seit, Kennzeichen und Träger nach Breite wegfallen, die Bemerkung voreingestellt aus ist und niemand etwas gewählt hat
- **THEN** heißt der Schalter „Spalten“, und im Menü sind diese sechs Spalten ohne Häkchen

#### Scenario: Eigene Wahl
- **WHEN** in derselben Liste zusätzlich „Status“ abgewählt wird
- **THEN** heißt der Schalter „Spalten · 7 ausgeblendet“

#### Scenario: Zurück zur Vorgabe
- **WHEN** „Status“ danach wieder angewählt wird
- **THEN** heißt der Schalter wieder „Spalten“

#### Scenario: Kartenverwaltung unter lg
- **WHEN** die Online-Quellen-Verwaltung unterhalb von `lg` steht, URL und Attribution nach Breite wegfallen und niemand etwas gewählt hat
- **THEN** heißt der Schalter „Spalten“
