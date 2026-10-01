# Spec Delta

## Purpose

Legt fest, wie die gebündelten Aktionen eines Datensatzes (Zeile, Karte, Chip, Detailkopf)
erreichbar sind: ein Auslöser je Datensatz, eindeutig benannt, mit vorhersehbarem Menü, das
nur die gewählte Aktion auslöst.

## ADDED Requirements

### Requirement: Ein Auslöser je Datensatz mit Zeilenkennung

Gebündelte Aktionen eines Datensatzes SHALL über genau einen Knopf mit Dreipunkt-Zeichen und
ohne sichtbare Beschriftung erreichbar sein. Sein zugänglicher Name MUST eine Kennung des
Datensatzes enthalten (Nummer, Name, Bezeichnung oder Autor mit Uhrzeit), damit mehrere
Auslöser auf einer Seite per Name unterscheidbar sind. Das Zeichen selbst MUST für
Hilfstechnik verborgen sein.

#### Scenario: Zwei Nachrichten im Chat
- **WHEN** der Chat heute zwei Nachrichten mit Aktionen zeigt, eine von „Meier“ um 14:02 und eine von „Schulz“ um 14:05
- **THEN** heißen ihre Auslöser „Aktionen zu Nachricht von Meier, 1402“ und „Aktionen zu Nachricht von Schulz, 1405“ (Uhrzeit taktisch wie in der Kopfzeile)

#### Scenario: Dieselbe Minute
- **WHEN** „Meier“ heute um 14:02 zwei Nachrichten schreibt
- **THEN** heißen ihre Auslöser „Aktionen zu Nachricht von Meier, 1402 (1)“ und „… (2)“ in Listenreihenfolge

#### Scenario: Zeile einer Tabelle
- **WHEN** die Tabelle der Betreuungsstellen eine Stelle „Turnhalle Nord“ mit Aktionen zeigt
- **THEN** heißt ihr Auslöser „Aktionen zu Stelle Turnhalle Nord“

### Requirement: Kein Auslöser ohne Aktion

Bleibt nach Rechte- und Zustandsprüfung keine Aktion für das Menü übrig, SHALL kein Auslöser
erscheinen, auch kein deaktivierter.

#### Scenario: Gelöschte Nachricht
- **WHEN** der Chat eine gelöschte Nachricht zeigt
- **THEN** trägt sie keinen Aktionen-Auslöser

#### Scenario: Ohne Schreibrecht
- **WHEN** eine Person ohne Schreibrecht die ETB-Zeitachse öffnet und kein Eintrag eine Aktion für sie hat
- **THEN** zeigt kein Eintrag einen Aktionen-Auslöser

### Requirement: Unumkehrbares steht rot hinter einem Trenner

Das Menü SHALL zuerst die umkehrbaren Aktionen in Lieferreihenfolge zeigen. Unumkehrbare oder
entfernende Aktionen MUST rot und, wenn davor umkehrbare stehen, hinter genau einem Trenner
folgen. Eine Aktion, die gerade nicht möglich ist, SHALL im Menü deaktiviert stehen, wenn ihr
Fehlen die Bedienung verwirren würde.

#### Scenario: Pegel mit Prognose
- **WHEN** das Menü eines Pegels mit Prognose geöffnet wird
- **THEN** stehen „Nach oben“, „Nach unten“, „Prognose ändern …“, dann ein Trenner, dann rot „Prognose löschen“ und „Entfernen“

#### Scenario: Erster Pegel
- **WHEN** das Menü des obersten Pegels geöffnet wird
- **THEN** steht „Nach oben“ deaktiviert im Menü

### Requirement: Der Fokus springt beim Öffnen ins Menü

Öffnet jemand das Menü, SHALL der Tastaturfokus ins Menü wandern, sodass die Pfeiltasten sofort
einen Eintrag hervorheben und Escape das Menü schließt.

#### Scenario: Menü per Tastatur
- **WHEN** jemand den Auslöser eines ETB-Eintrags per Tastatur fokussiert und mit Enter öffnet
- **THEN** liegt der Fokus im Menü, die Pfeiltaste nach unten hebt einen Eintrag hervor, und Escape schließt das Menü

### Requirement: Ein Griff ins Menü löst nur die gewählte Aktion aus

Ein Klick in das geöffnete Menü, auf einen Eintrag oder auf seinen Rand, SHALL keine Wirkung des
umgebenden Datensatzes auslösen (Zeile öffnen, Chip bearbeiten, Karte wählen). Ein Klick auf
einen Eintrag MUST genau dessen Aktion auslösen.

#### Scenario: Menü in einer klickbaren Zeile
- **WHEN** eine Zeile auf Klick ihre Detailansicht öffnet und jemand im Aktionsmenü dieser Zeile einen Eintrag wählt
- **THEN** löst nur die gewählte Aktion aus, und die Detailansicht öffnet sich nicht

#### Scenario: Klick auf den Rand des Menüs
- **WHEN** jemand auf den Innenrand des geöffneten Menüs neben die Einträge klickt
- **THEN** löst weder eine Aktion noch die Wirkung des umgebenden Datensatzes aus

### Requirement: Rückfrage im Dialog, nicht im Menü

Braucht eine Aktion aus dem Menü eine Rückfrage, SHALL sie in einem Dialog erscheinen, der nach
dem Schließen des Menüs öffnet, nicht in einer Blase am Menüeintrag.

#### Scenario: Nachricht wird währenddessen gelöscht
- **WHEN** der Dialog „Nachricht wirklich löschen?“ offen ist und dieselbe Nachricht anderswo gelöscht wird
- **THEN** schließt der Dialog, und es wird kein zweites Löschen gesendet

#### Scenario: Eigene Nachricht löschen
- **WHEN** jemand im Menü einer eigenen Nachricht „Löschen“ wählt
- **THEN** schließt das Menü, ein Dialog fragt „Nachricht wirklich löschen?“, und erst „Ja, löschen“ löscht die Nachricht

#### Scenario: Rückfrage abbrechen
- **WHEN** jemand im Dialog „Nachricht wirklich löschen?“ abbricht
- **THEN** bleibt die Nachricht unverändert
