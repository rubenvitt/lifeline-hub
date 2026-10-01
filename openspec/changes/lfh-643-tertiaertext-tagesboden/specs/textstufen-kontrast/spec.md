# Spec Delta

## Purpose

Die Textstufen der Oberfläche (`text`, `text2`, `gedaempft`, `schwach`) in Tag- und
Nachtbetrieb: welchen Kontrastboden jede Stufe hält, wie weit benachbarte Stufen mindestens
auseinanderliegen und für welchen Text eine Ausnahme gilt.

## ADDED Requirements

### Requirement: Ein Kontrastboden für jede Textstufe

Jede Textstufe SHALL auf jeder deckenden Fläche ihres Modus den Textboden halten: im
Tagbetrieb mindestens 7 : 1, im Nachtbetrieb mindestens 5 : 1. Das gilt auch für die
Tertiärstufe `schwach`, also für Augenbrauen, Metazeilen, Platzhalter und Feldhilfen. Deckende
Flächen sind die Flächenstufen, die Kopfbänder, die deckenden Status- und Bannerflächen und die
Zeilentönungen. Durchscheinende Füllungen sind keine Textgründe.

#### Scenario: Tertiärtext auf der dunkelsten Tagesfläche

- **WHEN** Text in der Stufe `schwach` im Tagbetrieb auf `flaeche3` steht, etwa in der aktiven Zeile
- **THEN** liegt sein Kontrast bei mindestens 7 : 1

#### Scenario: Tertiärtext auf einer Statusfläche

- **WHEN** die Augenbraue „fällig“ im Tagbetrieb auf der überfälligen Ablösungskarte (`alarmFlaeche`) steht
- **THEN** liegt ihr Kontrast bei mindestens 7 : 1

#### Scenario: Feldhilfe im Dialog bei Nacht

- **WHEN** im Nachtbetrieb eine Feldhilfe auf der Dialogfläche steht
- **THEN** liegt ihr Kontrast bei mindestens 5 : 1

#### Scenario: Sekundärtext hält denselben Boden

- **WHEN** Text in der Stufe `gedaempft` im Tagbetrieb auf `flaeche3` oder `alarmFlaeche` steht
- **THEN** liegt sein Kontrast bei mindestens 7 : 1

### Requirement: Die Rangfolge der Textstufen bleibt sichtbar

Benachbarte Textstufen SHALL sich in jedem Modus um mindestens 5 Einheiten der CIE-Helligkeit
(ΔL\*) unterscheiden: `text` von `text2`, `text2` von `gedaempft` und `gedaempft` von `schwach`.
Die Stufen MUST in dieser Reihenfolge vom stärksten zum schwächsten Kontrast gegen `grund`
liegen.

#### Scenario: Tertiärtext bleibt von Sekundärtext unterscheidbar

- **WHEN** die Tagespalette `gedaempft` und `schwach` festlegt
- **THEN** liegen die beiden mindestens 5 ΔL\* auseinander, und `schwach` hat auf `grund` den geringeren Kontrast

#### Scenario: Eine Anhebung, die die Rangfolge einebnet, wird rot

- **WHEN** jemand `schwach` so weit abdunkelt, dass es weniger als 5 ΔL\* von `gedaempft` entfernt liegt
- **THEN** schlägt der Wächter der Textstufen fehl

### Requirement: Nur Gesperrtes unterschreitet den Textboden

Text unter dem Textboden SHALL es nur für gesperrte, nicht bedienbare Einträge geben. Er MUST
mindestens 4,5 : 1 halten, und die Sperre MUST zusätzlich ein Zeichen ohne Farbe tragen. Für
Tertiärtext gibt es keine Ausnahme.

#### Scenario: Browser-Gate ohne Tertiär-Ausnahme

- **WHEN** ein Kontrast-Gate einer Seite jeden Text im Inhalt misst
- **THEN** gilt für Text in der Stufe `schwach` dieselbe Schranke wie für jeden anderen Text (Tag 7, Nacht 5), nicht 4,5

#### Scenario: Gesperrter Rahmeneintrag

- **WHEN** ein Eintrag im Rahmen gesperrt ist
- **THEN** hält seine Schrift mindestens 4,5 : 1 auf dem Leistengrund und bleibt sichtbar schwächer als ein freier Eintrag

### Requirement: Die Augenbraue wird im Browser gemessen

Der Kontrast der Augenbraue SHALL in beiden Modi im Browser gegen den tatsächlich gerenderten
Grund gemessen werden, jeweils auf `grund`, `paneel` und `flaeche`. Die Messung MUST
zusichern, dass der gemessene Grund die genannte Fläche ist, damit sie nicht still auf eine
hellere Fläche ausweicht.

#### Scenario: Augenbraue auf drei Flächen

- **WHEN** das Gate im Tag- oder Nachtbetrieb je eine Augenbraue auf `grund`, `paneel` und `flaeche` misst
- **THEN** hält jede den Textboden des Modus, und der gemessene Grund entspricht der jeweiligen Fläche
