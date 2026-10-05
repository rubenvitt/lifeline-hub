# textkontrast-rollen Specification

## Purpose
Legt fest, dass Text, den antd app-weit aus Rollen ableitet (Link, Beschreibung, Tabellenkopf,
Formularmeldung, Fehlertext außerhalb von Formularen, Knopf unter dem Zeiger), die Kontrastböden
der Bedien-Leitlinie hält (Kriterium 5: Tag ≥ 7 : 1, Nacht ≥ 5 : 1). Kein Modul soll dafür eine eigene Überschreibung brauchen.

## Requirements

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
- **THEN** hält seine Beschriftung gegen den dort komponierten Grund (Knopffläche unter dem Zeiger
  über der Hervorhebung der Zeile) im Tag ≥ 7 : 1 und in der Nacht ≥ 5 : 1

### Requirement: Linkfarbe ist die Textrolle Bedien

Jeder Link, den antd färbt (Anker, `Typography.Link`, Knopf vom Typ `link`), MUST in Ruhe, unter
dem Zeiger und beim Drücken die Textrolle für blauen Bedientext tragen. Kein Modul MUST dafür
eine eigene Farbe setzen. Unter dem Zeiger MUST sich ein Link ohne Farbwechsel unterscheiden
lassen.

#### Scenario: Link ohne lokale Überschreibung
- **WHEN** ein antd-Link ohne eigenen `style` im Tag- oder im Nachtmodus auf dem Seitengrund steht
- **THEN** hält sein Text ≥ 7 : 1 (Tag) beziehungsweise ≥ 5 : 1 (Nacht)

#### Scenario: Link unter dem Zeiger
- **WHEN** der Zeiger über einem Link steht
- **THEN** ist der Link unterstrichen
- **AND** sein Textkontrast hält denselben Boden wie in Ruhe

### Requirement: Beschreibungstext auf der zweiten Textstufe

Text, den antd als Beschreibung oder sekundär auszeichnet (darunter `Typography` vom Typ
`secondary`, die Seitenbeschreibung des Seitenkopfs, ein leerer Wert „—“), MUST die zweite
Textstufe tragen. Die tertiäre Stufe für Augenbraue, Platzhalter und Icons MUST dafür nicht
verwendet werden.

#### Scenario: Leerer Wert in der Tabelle
- **WHEN** eine Zeile der Dokumentenablage keinen Bezug hat und „—“ zeigt
- **THEN** hält „—“ im Tag ≥ 7 : 1 und in der Nacht ≥ 5 : 1

### Requirement: Tabellenkopf auf der zweiten Textstufe

Der Kopftext einer Katalogtabelle MUST die zweite Textstufe tragen und auf dem Kopfband den Boden
der Spec halten.

#### Scenario: Kopf der Katalogtabelle
- **WHEN** eine Katalogtabelle im Tag- oder im Nachtmodus gerendert ist
- **THEN** hält der Text der ersten Kopfzelle ≥ 7 : 1 (Tag) beziehungsweise ≥ 5 : 1 (Nacht)

### Requirement: Formularmeldung in der Textrolle des Status

Fehler- und Warnmeldungen eines Formularfelds und die Pflichtmarke MUST die Textrolle des Status
tragen (`alarm` beziehungsweise `achtung` als Text), nicht deren Füllfarbe. Rahmen und Icons des
Eingabefelds bleiben bei der Füllfarbe.

#### Scenario: Pflichtmeldung im Ablegen-Dialog
- **WHEN** im Dialog „Dokument ablegen“ ohne Datei auf „Ablegen“ gedrückt wird
- **THEN** erscheint „Bitte eine Datei wählen“
- **AND** die Meldung hält im Tag ≥ 7 : 1 und in der Nacht ≥ 5 : 1

### Requirement: Knopfbeschriftung unter dem Zeiger

Die Beschriftung eines Standardknopfs (umrandet, nicht gefüllt) MUST unter dem Zeiger und beim
Drücken den Boden der Spec halten. Rand und Fläche des Knopfs MAY ihren Hover-Ton behalten.

#### Scenario: Abbrechen unter dem Zeiger
- **WHEN** der Zeiger über „Abbrechen“ im Dialog „Dokument ablegen“ steht
- **THEN** hält die Beschriftung im Tag ≥ 7 : 1 und in der Nacht ≥ 5 : 1

### Requirement: Keine Farbe außerhalb der Rollen

Die Farben dieser Spec MUST aus den bestehenden Rollen kommen. Eine neue Farbe außerhalb der
Rollenquelle (TS-Paletten und gespiegelte CSS-Rollen) MUST NOT entstehen. Ändert sich der Wert
einer Rolle, MUST er in der TS-Palette und im CSS-Spiegel gleich lauten. Der Wert der tertiären
Textstufe bleibt von dieser Spec unberührt.

#### Scenario: Rollenquelle unverändert in der Menge
- **WHEN** die Änderung umgesetzt ist
- **THEN** führen die Paletten beider Modi dieselben Rollen wie vorher
- **AND** jeder Rollenwert der TS-Palette steht gleichlautend im CSS-Spiegel

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

### Requirement: Fehlertext außerhalb von Formularen in der Textrolle

Roter Text, mit dem die Anwendung außerhalb eines Formulars einen Fehler oder einen Verzug meldet,
MUST die Textrolle `alarm` als Text tragen, nicht deren Füllfarbe. Gemeint ist etwa „nicht
gefunden“, eine ungültige Eingabe, ein Ablehnungsgrund oder „Überfällig“. Er MUST im Tagmodus
≥ 7 : 1 und im Nachtmodus ≥ 5 : 1 gegen den Grund halten, auf dem er steht. Ist er ein Link, gilt
das auch unter dem Zeiger und beim Drücken. Die Färbung MUST app-weit aus einer Stelle kommen; keine
Seite und kein Baustein MUST dafür eine eigene Farbe setzen. Gefahrknöpfe, Fehlerränder von
Feldern und die Kante einer alarmierten Karte MUST die Füllfarbe behalten.

#### Scenario: Nicht gefunden auf dem Seitengrund
- **WHEN** ein Befehl aufgerufen wird, den es im Einsatz nicht gibt, im Tag- und im Nachtmodus
- **THEN** erscheint „Befehl nicht gefunden.“
- **AND** der Text hält gegen den Seitengrund im Tag ≥ 7 : 1 und in der Nacht ≥ 5 : 1

#### Scenario: Überfällig auf der Karte eines überfälligen Auftrags
- **WHEN** die Auftragsliste eines Einsatzes mit einem offenen Auftrag geöffnet wird, dessen Frist
  abgelaufen ist, im Tag- und im Nachtmodus
- **THEN** trägt seine Karte den Hinweis „Überfällig“
- **AND** der Hinweis hält gegen die Fläche der alarmierten Karte im Tag ≥ 7 : 1 und in der Nacht
  ≥ 5 : 1

#### Scenario: Füllfarbe bleibt, wo sie keine Schrift ist
- **WHEN** die Änderung umgesetzt ist
- **THEN** bleibt das globale Gefahrrot der antd-Tokens die Füllfarbe `alarm`
- **AND** die linke Kante einer alarmierten Karte trägt weiter die Füllfarbe `alarm`
