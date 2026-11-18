# Spec Delta

## Purpose
Text der Oberfläche erscheint in benannten Stufen einer festen Schriftskala und in benannten Tönen, damit Größen und Gewichte nicht an jeder Stelle neu erfunden werden und Metaangaben überall gleich aussehen.

## ADDED Requirements

### Requirement: Eine feste Schriftskala mit Kartentitel

Die Schriftskala SHALL die Stufen `ueberschrift`, `seitentitel`, `kartentitel`, `text`, `textKlein`, `augenbraue`, `railEtikett`, `meta`, `datenwertKlein`, `datenwert` und `datenwertGross` haben. Die Stufe `kartentitel` MUST 15 px groß sein, Gewicht 600, in der Textfamilie. Die Größen der Stufen MUST NOT von der Bediendichte abhängen.

#### Scenario: Kartentitel
- **WHEN** der Titel einer Karte oder eines Listeneintrags in der Stufe `kartentitel` steht
- **THEN** ist er 15 px groß und hat Gewicht 600

#### Scenario: Dichte ändert die Stufe nicht
- **WHEN** von `kompakt` auf `handschuh` umgeschaltet wird
- **THEN** behält ein Text in der Stufe `textKlein` 12 px

### Requirement: Text in Stufe und Ton

Ein Baustein für Text SHALL eine Stufe der Skala und einen Ton aus `text`, `text2`, `gedaempft`, `schwach` und `alarm` annehmen und Größe, Gewicht, Familie, Sperrung und Farbe daraus setzen. Eine freie Schriftgröße MUST NOT übergeben werden können. Das Element (etwa Absatz, Überschrift, Inline-Text) SHALL wählbar sein, ohne dass sich das Aussehen ändert.

#### Scenario: Gedämpfter Hinweis
- **WHEN** ein Hinweis in Stufe `textKlein` und Ton `gedaempft` gesetzt wird
- **THEN** ist er 12 px groß und trägt die Farbe der Rolle `gedaempft` im aktiven Modus

#### Scenario: Überschrift ohne andere Optik
- **WHEN** ein Kartentitel als Überschrift der Ebene 3 ausgezeichnet wird
- **THEN** steht er als `h3` im Baum und sieht aus wie in der Stufe `kartentitel`

### Requirement: Metazeile in einer Form

Eine Zeile mit Metaangaben zu einem Datensatz SHALL ihre Teile in der Stufe `textKlein` und dem Ton `schwach` zeigen und zwischen zwei Teilen „·“ setzen. Der Trenner MUST vor Hilfstechnik verborgen sein. Ein leerer Teil MUST samt seinem Trenner entfallen. Ein Teil mit Zahl, Zeit, Kennzeichen oder Nummer SHALL in der Zahlenfamilie mit gleich breiten Ziffern stehen. Reicht die Breite nicht, SHALL die Zeile zwischen Teilen umbrechen.

#### Scenario: Leere Angabe
- **WHEN** eine Metazeile aus Kennzeichen, leerer Wache und Änderungszeit besteht
- **THEN** zeigt sie Kennzeichen und Änderungszeit mit genau einem Trenner dazwischen

#### Scenario: Vorleser
- **WHEN** ein Screenreader die Metazeile vorliest
- **THEN** liest er die Teile ohne die Trenner

### Requirement: Keine neuen freien Schriftgrößen

Neuer Code MUST NOT eine Schriftgröße als Zahl-Literal setzen, weder im Stilobjekt noch als px-Wert in handgeschriebenem CSS außerhalb der Rollenquelle. Bestehende Literale SHALL als Schuld je Datei geführt werden, die nur sinken darf. Die Skala selbst, der Großbild-Lagemonitor, die Prosa der Hilfe, die Anmeldeseite und Druckansichten sind ausgenommen und SHALL mit Grund geführt werden.

#### Scenario: Neues Literal
- **WHEN** eine Datei ohne Schuld eine Schriftgröße als Zahl wie 13 bekommt
- **THEN** schlägt die Prüfung fehl und nennt Datei, Zeile und Wert

#### Scenario: Schuld sinkt
- **WHEN** in einer verschuldeten Datei Schriftgrößen auf Stufen umgestellt werden
- **THEN** schlägt die Prüfung fehl, bis die geführte Schuld dieser Datei auf den neuen Stand gesenkt ist, und steigen darf sie nie
