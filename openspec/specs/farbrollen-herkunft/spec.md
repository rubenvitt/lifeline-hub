# farbrollen-herkunft Specification

## Purpose
Legt fest, woher Farbwerte im Frontend kommen: aus den Farbrollen des Themes und nirgends sonst.
Ein Wert, der neben einer Rolle steht, driftet still, sobald die Palette sich ändert, und entgeht
den Kontrastmessungen der Rollen.

## Requirements

### Requirement: Handgeschriebenes CSS nennt keine rohen Farbwerte

Handgeschriebenes CSS außerhalb des Theme-Verzeichnisses MUST keinen rohen Hex-Farbwert
enthalten. Es SHALL Farben ausschließlich über die Custom Properties der Farbrollen lesen.
Kommentare zählen nicht als Farbwert.

#### Scenario: Rolle statt Wert
- **WHEN** eine Stylesheet-Regel außerhalb des Themes eine Hintergrund-, Text- oder Randfarbe setzt
- **THEN** liest sie den Wert über eine Custom Property der Farbrollen

#### Scenario: Wert im Kommentar
- **WHEN** ein Kommentar in einem solchen Stylesheet einen Hex-Wert nennt
- **THEN** gilt das nicht als Verstoß

### Requirement: Gate weist rohe Farbwerte in CSS nach

Ein Gate im Sammel-Gate MUST jeden rohen Hex-Farbwert in handgeschriebenem CSS außerhalb des
Theme-Verzeichnisses mit Datei und Zeile melden und dabei rot werden. Es MUST beim Einführen grün
sein und keine Freistellungsliste führen.

#### Scenario: Neuer roher Wert
- **WHEN** jemand in ein Stylesheet außerhalb des Themes einen Hex-Farbwert schreibt
- **THEN** schlägt das Gate fehl und nennt Datei, Zeile und Wert

#### Scenario: Theme bleibt Quelle
- **WHEN** das Rollen-Stylesheet im Theme-Verzeichnis Hex-Werte für die Rollen definiert
- **THEN** meldet das Gate sie nicht
