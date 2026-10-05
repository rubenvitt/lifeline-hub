# Spec Delta

## MODIFIED Requirements

### Requirement: Blöcke in fester Reihenfolge

Der Einsatzbericht SHALL seine Blöcke in dieser Reihenfolge drucken: Stammdaten, Zeiten,
Führung, Kräfte, Lage, Bilanz, ETB-Auszug, Anlage Einheiten mit Einsatzzeiten, Anlage Personal
je Kopf. Die ersten sieben bilden den Standardumfang, die beiden Anlagen sind optional. Jeder
gedruckte Block SHALL eine Überschrift tragen und im Ausdruck mit seinem Inhalt beginnen. Ein
gedruckter, lesbarer Block ohne Daten MUST mit einem Vermerk stehen bleiben („keine Einträge“)
und MUST NOT wegfallen.

#### Scenario: Vollständiger Bericht

- **WHEN** ein Einsatz mit Daten in allen Modulen ohne Auswahl als Bericht geöffnet wird
- **THEN** stehen die sieben Blöcke des Standardumfangs in der genannten Reihenfolge
- **AND** keine der beiden Anlagen steht im Bericht

#### Scenario: Leerer Block bleibt stehen

- **WHEN** im Einsatz kein Schaden erfasst ist und das Modul Schäden lesbar ist
- **THEN** steht im Block Bilanz bei den Schäden „keine Einträge“

#### Scenario: Reihenfolge unabhängig von der Adresse

- **WHEN** die Adresse die Blöcke in der Folge ETB-Auszug, Stammdaten nennt
- **THEN** druckt der Bericht Stammdaten vor dem ETB-Auszug

### Requirement: Vollständig oder gar nicht

Der Bericht SHALL nur druckbar sein, wenn die druckende Person jedes im Einsatz sichtbare Modul
lesen darf, aus dem die gewählten Blöcke schöpfen, und alle Abrufe dieser Blöcke gelungen sind.
Ist ein solches Modul für sie gesperrt, MUST die Ansicht die fehlenden Module nennen und kein
Drucken anbieten. Scheitert ein Abruf, MUST das Drucken gesperrt sein, bis ein neuer Versuch
gelingt. Solange geladen wird, MUST das Drucken gesperrt sein. Für abgewählte Blöcke MUST das
System keine Daten abrufen.

#### Scenario: Modul für die Rolle gesperrt

- **WHEN** das Modul Personen im Einsatz sichtbar, aber für die Rolle der Person gesperrt ist
- **AND** der Block Bilanz gewählt ist
- **THEN** zeigt die Ansicht „Für den Einsatzbericht fehlen Rechte an: Personen“
- **AND** sie bietet kein Drucken an

#### Scenario: Gesperrtes Modul abgewählt

- **WHEN** das Modul Personen für die Rolle der Person gesperrt ist
- **AND** sie den Block Bilanz abwählt und alle übrigen Module lesen darf
- **THEN** ist der Bericht ohne Bilanz druckbar
- **AND** das System ruft keine Personen ab

#### Scenario: Abruf scheitert

- **WHEN** der Abruf der Lageberichte mit einem Serverfehler scheitert
- **THEN** nennt die Ansicht den Fehler und bietet einen neuen Versuch an
- **AND** das Drucken bleibt gesperrt

#### Scenario: Aufbewahrungsfrist abgelaufen

- **WHEN** die Aufbewahrungsfrist des Einsatzes abgelaufen ist
- **THEN** zeigt die Ansicht, dass der Bericht nicht mehr erzeugt werden kann
- **AND** sie bietet weder Drucken noch einen neuen Versuch an

#### Scenario: Rollensperre als Vorgabe der Organisation

- **WHEN** ein Modul des Berichts für die Rolle der Person über die Vorgabe der Organisation
  gesperrt ist
- **THEN** nennt die Ansicht das Modul, auf das kein Zugriff besteht
- **AND** sie bietet kein Drucken an

## ADDED Requirements

### Requirement: Blöcke an- und abwählen

Die Druckansicht SHALL am Bildschirm eine Auswahl aller Blöcke anbieten, die im Ausdruck nicht
erscheint. Ein abgewählter Block MUST im Ausdruck ganz fehlen, ohne Überschrift, Vermerk oder
freien Platz. Mindestens ein Block MUST gewählt bleiben.

#### Scenario: Bilanz abwählen

- **WHEN** eine Person im Standardumfang den Block Bilanz abwählt
- **THEN** stehen im Bericht Stammdaten, Zeiten, Führung, Kräfte, Lage und ETB-Auszug
- **AND** vom Block Bilanz steht weder Überschrift noch Vermerk im Bericht

#### Scenario: Letzter Block

- **WHEN** nur noch der Block Stammdaten gewählt ist
- **THEN** lässt er sich nicht abwählen

### Requirement: Auswahl in der Adresse

Die Auswahl der Blöcke SHALL in der Adresse der Druckansicht stehen, sodass sie teilbar ist und
ein Neuladen übersteht. Fehlt sie, MUST der Standardumfang gelten. Unbekannte Blockschlüssel
MUST verworfen werden und MUST NOT als Auswahl gelten oder genannt werden. Bleibt nach dem
Verwerfen kein gültiger Schlüssel, MUST der Standardumfang gelten.

#### Scenario: Neuladen

- **WHEN** eine Person Lage und ETB-Auszug abwählt und die Adresse neu lädt
- **THEN** zeigt der Bericht dieselbe Auswahl

#### Scenario: Unbekannter Schlüssel

- **WHEN** die Adresse die Blöcke Stammdaten und „kosten“ nennt
- **THEN** druckt der Bericht nur Stammdaten
- **AND** „kosten“ erscheint weder im Bericht noch im Druckkopf

#### Scenario: Nur unbekannte Schlüssel

- **WHEN** die Adresse nur den Block „kosten“ nennt
- **THEN** druckt der Bericht den Standardumfang

### Requirement: Druckkopf nennt den Umfang

Der Druckkopf SHALL den Umfang nennen: „Standardumfang“, wenn genau die sieben Blöcke des
Standardumfangs gedruckt werden, sonst „Auswahl“ mit den gedruckten Blöcken in
Druckreihenfolge. Die genannte Menge MUST der gedruckten entsprechen.

#### Scenario: Ohne Auswahl

- **WHEN** der Bericht ohne Auswahl gedruckt wird
- **THEN** nennt der Druckkopf „Standardumfang“

#### Scenario: Mit Auswahl

- **WHEN** nur Stammdaten, Kräfte und die Anlage Personal je Kopf gewählt sind
- **THEN** nennt der Druckkopf „Auswahl: Stammdaten, Kräfte, Anlage Personal je Kopf“

### Requirement: Anlage Einheiten mit Einsatzzeiten

Die optionale Anlage Einheiten mit Einsatzzeiten SHALL je Einheit mit Zeitachse den Namen,
den Beginn der ersten Periode, das Ende der letzten Periode und die Einsatzzeit als Summe
ihrer Perioden nennen. Eine noch laufende Periode MUST als Ende „läuft“ stehen und bis zum
Stand des Berichts zählen, bei einem abgeschlossenen Einsatz höchstens bis zum Abschluss.
Einheiten ohne Zeitachse MUST NOT mit einer Einsatzzeit von 0 erscheinen.

#### Scenario: Einheit noch im Einsatz

- **WHEN** eine Einheit seit 08:00 im laufenden Einsatz ist und der Bericht um 14:32 gedruckt wird
- **THEN** steht sie mit Beginn 08:00, Ende „läuft“ und Einsatzzeit 6 h 32

#### Scenario: Einheit ohne Zeitachse

- **WHEN** eine Einheit im Einsatz geführt ist, aber kein Zeitachsen-Ereignis hat
- **THEN** nennt die Anlage, für wie viele Einheiten keine Zeitachse erfasst ist
- **AND** die Einheit steht nicht mit einer Einsatzzeit von 0 in der Tabelle

### Requirement: Anlage Personal je Kopf

Die optionale Anlage Personal je Kopf SHALL je im Einsatz geführter Einsatzkraft Name,
Funktion, Einheit, Beginn, Ende und Einsatzzeit nennen, als Helfernachweis. Sie MUST nur Daten
von Einsatzkräften enthalten, keine Kontaktdaten und nie Daten Betroffener. Ist sie gedruckt,
MUST der Druckkopf „enthält Namen von Einsatzkräften“ vermerken. Eine Kraft ohne Zeitachse
MUST ohne Zeiten stehen statt mit 0.

#### Scenario: Helfernachweis

- **WHEN** die Anlage Personal je Kopf gewählt ist und zwölf Einsatzkräfte geführt sind
- **THEN** stehen alle zwölf mit Name, Funktion, Einheit und ihren Einsatzzeiten im Bericht
- **AND** der Druckkopf vermerkt „enthält Namen von Einsatzkräften“

#### Scenario: Kraft ohne Zeitachse

- **WHEN** eine Einsatzkraft geführt ist, aber kein Zeitachsen-Ereignis hat
- **THEN** steht sie mit Name, Funktion und Einheit und bei der Einsatzzeit „keine Zeitachse“

#### Scenario: Standardumfang ohne Namen

- **WHEN** der Bericht ohne Auswahl gedruckt wird
- **THEN** enthält er keine Namen von Einsatzkräften außer denen der Führung (Einsatzleitung,
  Stab, freigebende Personen)
