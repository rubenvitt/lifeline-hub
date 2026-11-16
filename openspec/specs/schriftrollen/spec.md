# schriftrollen Specification

## Purpose
Legt fest, wann Text in Mono und wann in Versalien mit Sperrung steht und wie ein Feldetikett
aussieht, damit Wörter in der Textschrift lesbar bleiben.

## Requirements

### Requirement: Mono nur für Zahl, Zeit, Kennung und Funkrufname

Mono SHALL nur Text tragen, der ganz aus einer Zahl, einer Zeit, einer Kennung oder einem
Funkrufnamen besteht. Kennungen sind auch das Typwort der ETB-Zeitachse, der Befehl `/typ` der
Schnellerfassung, Tastenkürzel, die Wortmarke und FMS-Kürzel. Ein Text mit Wörtern MUST in der
Textschrift stehen.

#### Scenario: Metazeile mit Wörtern
- **WHEN** im ETB ein Eintrag mit der Zeile „von Leitstelle Musterstadt · an Einsatzleitung“ steht
- **THEN** steht diese Zeile in der Textschrift, nicht in Mono

#### Scenario: Zeit und Funkrufname
- **WHEN** im ETB der Zeitstempel eines Eintrags und der Funkrufname einer Einheit stehen
- **THEN** stehen beide in Mono

### Requirement: Gemischte Knoten in der Textschrift mit gleich breiten Ziffern

Ein Text, der Wörter und Zahlen mischt („Stand 14:32“, „3 Entwürfe“), SHALL ganz in der
Textschrift stehen. Ihre Ziffern MUST gleich breit gesetzt sein, damit Spalten und laufende Zähler
nicht flattern.

#### Scenario: Datenstand im Paneelkopf
- **WHEN** ein Paneel den Datenstand „Stand 14:32“ zeigt
- **THEN** steht er ganz in der Textschrift, und seine Ziffern sind gleich breit

### Requirement: Versalien nur in Köpfen

Versalien mit Sperrung SHALL nur in Paneelköpfen, Kennzahl-Titeln, Spaltenköpfen von Tabellen und
im Rail-Etikett stehen. Ein Etikett über oder neben einem Feld MUST gemischt geschrieben sein.

#### Scenario: Paneelkopf
- **WHEN** ein Paneel mit Titel steht
- **THEN** steht sein Titel in Versalien mit Sperrung

#### Scenario: Felder der Einsatzdaten
- **WHEN** die Einsatzdaten in der Ansicht und im Bearbeiten-Modus stehen
- **THEN** steht kein Feldetikett in Versalien

### Requirement: Das Feldetikett

Ein Feldetikett SHALL gemischt geschrieben in der Stufe 12 px (mit der Dichte wachsend), ohne
Sperrung und in der Textstufe `gedaempft` stehen, nicht in `schwach`. Auf `grund` und `paneel`
MUST es nachts mindestens 6:1 Kontrast halten, am Tag gilt der Textboden von 7:1.

#### Scenario: Etikett in der Detailansicht
- **WHEN** eine Detailansicht mit Feldern im Nachtbetrieb in `kompakt` steht
- **THEN** misst jedes Feldetikett 12 px, steht gemischt geschrieben und hält auf dem Paneel mindestens 6:1 Kontrast

#### Scenario: Etikett im Handschuh-Betrieb
- **WHEN** dieselbe Ansicht in `handschuh` steht
- **THEN** misst jedes Feldetikett das 1,25-Fache seiner Größe in `kompakt`
