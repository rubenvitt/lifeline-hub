# feldbreiten Specification

## Purpose
Eingabefelder füllen ihre Zeile bis zu einer benannten Obergrenze, damit sie am Führungsarbeitsplatz ruhig stehen und am schmalen Schirm nicht über den Rand ragen.

## Requirements

### Requirement: Feldbreite als benannte Obergrenze

Ein Feld SHALL eine Breite aus `kurz` (höchstens 120 px), `schmal` (höchstens 200 px), `mittel` (höchstens 320 px) und `voll` (ganze Zeile) annehmen; `voll` ist die Vorgabe. Das Steuerelement MUST die verfügbare Breite bis zu dieser Obergrenze füllen. Eine feste Pixelbreite MUST NOT übergeben werden können.

#### Scenario: Schmaler Schirm
- **WHEN** ein Feld der Breite `mittel` in einer 280 px breiten Spalte steht
- **THEN** ist das Steuerelement 280 px breit und ragt nicht über den Rand

#### Scenario: Breiter Schirm
- **WHEN** ein Feld der Breite `kurz` in einer 900 px breiten Spalte steht
- **THEN** ist das Steuerelement 120 px breit

### Requirement: Beschriftung und Fehlerzeile bleiben Teil des Formulars

Ein Feld SHALL Beschriftung, Pflichtkennzeichen, Hinweis und Fehlerzeile des Formulars tragen, an das es gebunden ist, und deren Prüfung unverändert übernehmen.

#### Scenario: Pflichtfeld leer
- **WHEN** ein Pflichtfeld leer gespeichert wird
- **THEN** zeigt es die Fehlerzeile des Formulars unter dem Steuerelement, wie ein Formularfeld ohne Breitenangabe

### Requirement: Keine feste Feldbreite im Verwaltungsteil

Im Verwaltungsteil (Stammdaten, Karten, globale Einstellungen, Benutzer) MUST ein Eingabefeld seine Breite nur über die benannte Obergrenze bekommen. Eine feste Zahlbreite an einem Eingabefeld MUST von der Prüfung abgelehnt werden; die Breite einer Tabellenspalte und eines Anzeigeelements fester Größe sind ausgenommen.

#### Scenario: Feste Breite
- **WHEN** im Verwaltungsteil ein Eingabefeld eine Breite von 280 px als Zahl bekommt
- **THEN** schlägt die Prüfung fehl und nennt Datei und Zeile
