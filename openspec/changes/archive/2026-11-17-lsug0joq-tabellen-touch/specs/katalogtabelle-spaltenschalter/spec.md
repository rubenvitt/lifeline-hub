# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
