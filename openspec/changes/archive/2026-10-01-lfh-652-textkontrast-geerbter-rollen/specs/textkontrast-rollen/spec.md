# Spec Delta

## Purpose

Legt fest, dass Text, den antd app-weit aus Rollen ableitet (Link, Beschreibung, Tabellenkopf,
Formularmeldung, Knopf unter dem Zeiger), die Kontrastböden der Bedien-Leitlinie hält (Kriterium 5:
Tag ≥ 7 : 1, Nacht ≥ 5 : 1). Kein Modul soll dafür eine eigene Überschreibung brauchen.

## ADDED Requirements

### Requirement: Böden für geerbten Text

Jede in dieser Spec genannte Textstelle MUST im Tagmodus ≥ 7 : 1 und im Nachtmodus ≥ 5 : 1
Kontrast halten. Gemessen wird im Browser gegen den tatsächlich komponierten Grund, auf dem die
Stelle ohne Zeiger und ohne Auswahl steht (Seitengrund, Fläche, Paneel, Tabellenkopf). Eine
Hervorhebungsfläche unter dem Zeiger (Hover- oder Aktivzeile) gehört nicht zu diesem Grund.

#### Scenario: Messung in beiden Modi
- **WHEN** die Dokumentenablage eines Einsatzes mit einem abgelegten Dokument im Tag- und im
  Nachtmodus geöffnet wird
- **THEN** halten Titel-Link, Tabellenkopf und der Strich „—“ einer leeren Bezugszelle im Tag
  ≥ 7 : 1 und in der Nacht ≥ 5 : 1
- **AND** die Böden 7 und 5 stehen als Literale im Test, nicht aus Produktwerten importiert

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
Textstufe tragen. Die tertiäre Stufe für Augenbraue, Platzhalter und Ikonen MUST dafür nicht
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
tragen (`alarm` beziehungsweise `achtung` als Text), nicht deren Füllfarbe. Rahmen und Ikonen des
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
Rollenquelle (TS-Paletten und gespiegelte CSS-Rollen) MUST NOT entstehen. Der Wert der tertiären
Textstufe bleibt von dieser Spec unberührt.

#### Scenario: Rollenquelle unverändert in der Menge
- **WHEN** die Änderung umgesetzt ist
- **THEN** führen die Paletten beider Modi dieselben Rollen mit denselben Werten wie vorher
