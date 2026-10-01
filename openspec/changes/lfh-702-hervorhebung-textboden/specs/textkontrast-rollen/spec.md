## MODIFIED Requirements

### Requirement: Böden für geerbten Text

Jede in dieser Spec genannte Textstelle MUST im Tagmodus ≥ 7 : 1 und im Nachtmodus ≥ 5 : 1
Kontrast halten. Gemessen wird im Browser gegen den tatsächlich komponierten Grund, auf dem die
Stelle steht: Seitengrund, Fläche, Paneel, Tabellenkopf und ebenso die Hervorhebungsfläche einer
Zeile unter dem Zeiger oder einer aktiven Zeile.

#### Scenario: Messung in beiden Modi
- **WHEN** die Dokumentenablage eines Einsatzes mit einem abgelegten Dokument im Tag- und im
  Nachtmodus geöffnet wird
- **THEN** halten Titel-Link, Tabellenkopf und der Strich „—“ einer leeren Bezugszelle im Tag
  ≥ 7 : 1 und in der Nacht ≥ 5 : 1
- **AND** die Böden 7 und 5 stehen als Literale im Test, nicht aus Produktwerten importiert

#### Scenario: Zeile unter dem Zeiger
- **WHEN** in der Dokumentenablage der Zeiger über der Zeile eines Dokuments steht und ihre
  Hervorhebung eingeschwungen ist
- **THEN** halten Titel-Link und „—“ dieser Zeile gegen die Hervorhebungsfläche im Tag ≥ 7 : 1 und
  in der Nacht ≥ 5 : 1

#### Scenario: Link-Knopf in einer Tabellenzeile unter dem Zeiger
- **WHEN** in der Betroffenenliste der Zeiger über dem leeren Knopf „Zustand hinzufügen“ einer
  Zeile steht
- **THEN** hält seine Beschriftung gegen die Hervorhebungsfläche der Zeile im Tag ≥ 7 : 1 und in
  der Nacht ≥ 5 : 1

### Requirement: Keine Farbe außerhalb der Rollen

Die Farben dieser Spec MUST aus den bestehenden Rollen kommen. Eine neue Farbe außerhalb der
Rollenquelle (TS-Paletten und gespiegelte CSS-Rollen) MUST NOT entstehen. Ändert sich der Wert
einer Rolle, MUST er in der TS-Palette und im CSS-Spiegel gleich lauten. Der Wert der tertiären
Textstufe bleibt von dieser Spec unberührt.

#### Scenario: Rollenquelle unverändert in der Menge
- **WHEN** die Änderung umgesetzt ist
- **THEN** führen die Paletten beider Modi dieselben Rollen wie vorher
- **AND** jeder Rollenwert der TS-Palette steht gleichlautend im CSS-Spiegel

## ADDED Requirements

### Requirement: Messung im eingeschwungenen Zustand

Ein Kontrastnachweis im Browser MUST erst messen, wenn die Animationen und Übergänge am gemessenen
Element und an seinen Vorfahren abgeschlossen sind. Das Ergebnis MUST vom Zeitpunkt der Messung
unabhängig sein: Liegt der eingeschwungene Wert unter dem Boden, ist der Nachweis rot, auch wenn
ein Zwischenwert während des Übergangs den Boden gehalten hätte.

#### Scenario: Hover-Übergang noch nicht abgeschlossen
- **WHEN** der Zeiger auf eine Tabellenzeile bewegt wird und deren Hintergrund noch in den
  Hover-Ton übergeht
- **THEN** misst der Nachweis erst nach dem Übergang, gegen den Hover-Ton

#### Scenario: Eingeschwungener Wert unter dem Boden
- **WHEN** eine Textstelle im eingeschwungenen Zustand unter dem Boden ihres Modus liegt
- **THEN** ist der Nachweis in jedem wiederholten Lauf rot
