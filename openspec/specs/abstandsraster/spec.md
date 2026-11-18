# abstandsraster Specification

## Purpose
Ein benanntes Abstandsraster je Dichtestufe trägt alle Innen- und Außenabstände sowie Lücken der Oberfläche, damit Abstände mit der Bediendichte mitwachsen und keine Seite eigene Pixelwerte erfindet.

## Requirements

### Requirement: Ein Raster je Dichtestufe auf Vielfachen von 4

Jede Dichtestufe (`kompakt`, `komfortabel`, `handschuh`) SHALL ein Abstandsraster mit den Stufen `xxs`, `xs`, `sm`, `md`, `lg` und `xl` haben. Jeder Wert MUST ein Vielfaches von 4 px sein. Innerhalb einer Stufe MUST die Folge nicht fallen, und keine Stufe MUST in einer dichteren Bedienung (`komfortabel`, `handschuh`) kleiner sein als in `kompakt`.

#### Scenario: Raster der kompakten Stufe
- **WHEN** die Dichtestufe `kompakt` aktiv ist
- **THEN** sind `xs`, `sm`, `md`, `lg` und `xl` gleich 4, 8, 12, 16 und 24 px

#### Scenario: Raster wächst mit der Dichte
- **WHEN** von `kompakt` auf `handschuh` umgeschaltet wird
- **THEN** ist jede Stufe des Rasters mindestens so groß wie in `kompakt`, und `sm` ist mindestens 16 px

### Requirement: Alle Abstandstoken der Komponentenbibliothek folgen dem Raster

Jedes Innen- und Außenabstandstoken der Komponentenbibliothek (`padding` und `margin` in allen Größen von XXS bis XL) SHALL seinen Wert aus dem Raster der aktiven Dichtestufe beziehen. Keines dieser Token MUST auf einer festen Vorgabe der Bibliothek stehen bleiben. Abgeleitete Polsterungen einzelner Steuerelemente und Inhaltsflächen gehören nicht dazu.

#### Scenario: Mittlere und große Abstandsstufe in Handschuh
- **WHEN** die Dichtestufe `handschuh` aktiv ist
- **THEN** sind die Abstandstoken der Größen MD und XL größer als in `kompakt`

### Requirement: Kein fester Abstand an der Dichte vorbei

Ein Baustein oder eine Seite MUST einen Abstand aus dem Raster der aktiven Dichtestufe lesen. Ein Abstandswert, der unabhängig von der gewählten Dichte auf `kompakt` festsitzt, MUST NOT angeboten werden.

#### Scenario: Seite in komfortabel
- **WHEN** eine Seite, die einen Rasterabstand nutzt, in `komfortabel` steht
- **THEN** misst dieser Abstand den Wert der Stufe in `komfortabel`, nicht den in `kompakt`

### Requirement: Keine neuen Abstands-Literale

Neuer Code MUST NOT einen Innen- oder Außenabstand oder eine Lücke als Zahl-Literal größer als 2 px setzen, weder im Stilobjekt noch als Abstandsangabe einer Layoutkomponente noch als px-Wert in handgeschriebenem CSS außerhalb der Rollenquelle. Bestehende Literale SHALL als Schuld je Datei geführt werden, die nur sinken darf.

#### Scenario: Neues Literal
- **WHEN** eine Datei ohne Schuld ein Abstands-Literal wie 8 oder `12px` bekommt
- **THEN** schlägt die Prüfung fehl und nennt Datei, Zeile und Wert

#### Scenario: Schuld sinkt
- **WHEN** in einer verschuldeten Datei Literale auf das Raster umgestellt werden
- **THEN** schlägt die Prüfung fehl, bis die geführte Schuld dieser Datei auf den neuen Stand gesenkt ist, und steigen darf sie nie

#### Scenario: Feinsatz
- **WHEN** ein Abstand 1 oder 2 px beträgt (Haarlinie, Symbolversatz) oder 0 ist
- **THEN** zählt er nicht als Abstands-Literal

### Requirement: Feste Ausnahmen mit Grund

Flächen, deren Abstände bewusst nicht der Bediendichte folgen, SHALL als Ausnahme mit Grund geführt werden: der Großbild-Lagemonitor (Betrachtungsabstand statt Bedienhand), die Prosa der Hilfe, die Anmeldeseite und Druckansichten. Für sie MUST die Prüfung auf neue Literale entfallen.

#### Scenario: Lagemonitor im Handschuh-Betrieb
- **WHEN** die Dichtestufe `handschuh` gewählt ist und der Lagemonitor angezeigt wird
- **THEN** behalten seine Großbild-Abstände ihre festen Werte

### Requirement: Stapel nehmen nur Rasterstufen

Ein Layoutbaustein, der Elemente senkrecht oder waagerecht reiht, SHALL seinen Abstand nur als benannte Stufe (`xxs`, `xs`, `sm`, `md`, `lg`, `xl`) annehmen und den Wert aus dem Raster der aktiven Dichtestufe lesen. Eine Zahl als Abstand MUST NOT übergeben werden können.

#### Scenario: Stapel in komfortabel
- **WHEN** ein Stapel mit Abstand `md` in der Dichtestufe `komfortabel` steht
- **THEN** beträgt die Lücke zwischen seinen Elementen 20 px

#### Scenario: Stapel in kompakt
- **WHEN** derselbe Stapel in `kompakt` steht
- **THEN** beträgt die Lücke 12 px
