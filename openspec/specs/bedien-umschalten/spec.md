# bedien-umschalten Specification

## Purpose
Legt fest, welche Form eine Wahl oder ein Umschalten in der Oberfläche bekommt, damit dieselbe Aufgabe überall gleich aussieht und sich gleich bedienen lässt.

## Requirements

### Requirement: Fläche umschalten über die Segmentleiste als Reiter

Schaltet eine Wahl die Fläche oder den Bereich darunter um, SHALL die Seite sie als Segmentleiste in der Rolle Reiterliste zeigen, mit einer zugehörigen Reiterfläche. Reiter der Komponentenbibliothek MUST NOT dafür verwendet werden, außer für Dokumentreiter, die Reiter anlegen und schließen.

#### Scenario: Aufträge
- **WHEN** eine Person die Aufträge-Seite öffnet
- **THEN** stehen „Einzelaufträge“ und „Einsatzbefehle“ als Segmentleiste mit den Rollen Reiterliste und Reiter, und die gewählte Fläche ist mit dem Reiter verbunden

#### Scenario: Tastatur
- **WHEN** der Fokus auf einem Reiter liegt, dessen Fläche auf derselben Seite steht, und die Person die Pfeiltaste nach rechts drückt
- **THEN** wechselt die Auswahl auf den nächsten Reiter und die Fläche darunter zeigt dessen Inhalt

#### Scenario: Reiter, die die Seite wechseln
- **WHEN** ein Reiter auf eine andere Seite führt (Fernmeldewesen: Kommunikationsplan) und die Person die Pfeiltaste drückt
- **THEN** bewegt die Pfeiltaste nur den Fokus, gewählt wird mit Enter oder Leertaste, und der Fokus bleibt in der Leiste

#### Scenario: Entwurfsreiter des ETB
- **WHEN** im ETB mehrere Entwürfe offen sind
- **THEN** stehen sie weiter als Dokumentreiter mit Anlegen und Schließen

### Requirement: Kurze Wahl im Formular über die Segmentleiste als Feld

Eine Wahl aus wenigen kurzen Werten in einem Formular SHALL als Segmentleiste in der Rolle Auswahlgruppe stehen. Eine Knopfgruppe aus Auswahlknöpfen MUST NOT dafür verwendet werden. Optionen mit erklärendem Text SHALL senkrecht als Auswahlliste stehen, viele oder aus Stammdaten stammende Werte als Auswahlfeld.

#### Scenario: Erhebung in der Betreuung
- **WHEN** eine Person im Betreuungsdialog die Art der Erhebung wählt
- **THEN** wählt sie in einer Segmentleiste, und der gewählte Wert wird mit dem Formular gespeichert

#### Scenario: Pflichtwahl ohne Angabe
- **WHEN** eine Pflichtwahl als Segmentleiste noch keinen Wert hat und das Formular abgeschickt wird
- **THEN** zeigt das Feld seine Fehlerzeile wie jedes andere Pflichtfeld

### Requirement: Eine Umschaltleiste je Ebene

Über einer Liste SHALL höchstens eine Segmentleiste für Sicht oder Status stehen. Weitere Einschränkungen derselben Liste MUST als Filter (Auswahlfeld oder Suche) in derselben Werkzeugzeile stehen.

#### Scenario: Aufträge filtern
- **WHEN** eine Person in den Einzelaufträgen nach Richtung und Empfänger filtern will
- **THEN** stehen „Richtung“ und „Empfänger“ als Auswahlfelder nebeneinander, und über der Liste steht nur die Segmentleiste „Ansicht“
