# bereitstellungsraum-lagekarte Specification

## Purpose
Ein Bereitstellungsraum ist ein Ort. Er trägt eine optionale Koordinate, die ohne
Tagebucheintrag gesetzt und live verteilt wird, und erscheint im Lage-Snapshot samt Belegung,
ohne die Modulfreigabe zu umgehen; die Schwärzung behält seine Lage als Geo-Skelett. Damit
kann die Lagekarte den Raum mit seinem Zeichen und seiner Belegung zeigen (Gegenstück zu
`betreuung-lagekarte`).

## Requirements

### Requirement: Koordinate eines Bereitstellungsraums

Das System SHALL an einem Bereitstellungsraum optional eine Koordinate führen, bestehend aus
Breite `lat` und Länge `lon`. Beide Werte MUST gemeinsam gesetzt oder gemeinsam leer sein, geprüft
gegen den gespeicherten Stand derselben Transaktion. Die Breite MUST zwischen −90 und 90 liegen,
die Länge zwischen −180 und 180; ein Verstoß MUST mit 422 abgelehnt werden, ohne etwas zu ändern.
Die Koordinate MUST beim Anlegen mitgegeben und über denselben Änderungsweg gesetzt, geändert und
entfernt werden können wie Bezeichnung, Standort und Notiz. Fehlt sie in einer Änderung, bleibt
sie unverändert; ist sie `null`, wird sie entfernt. Die Anzeige eines Raums MUST die Koordinate
tragen, wenn eine gesetzt ist, und das Feld sonst weglassen. Der Freitext `standort` MUST daneben
unverändert bestehen bleiben.

#### Scenario: Raum verorten
- **WHEN** eine Person mit Schreibrecht am BR „Sportplatz“ `lat` 51,93 und `lon` 8,87 setzt
- **THEN** trägt der Raum diese Koordinate, und Liste und Detail liefern sie

#### Scenario: Anlegen mit Koordinate
- **WHEN** ein Raum mit Bezeichnung, Standort „Sportplatz Nord“, `lat` 51,93 und `lon` 8,87 angelegt wird
- **THEN** trägt der neue Raum Standort und Koordinate

#### Scenario: Nur ein Wert des Paares
- **WHEN** eine Änderung nur `lat` setzt und der Raum bisher keine Koordinate hat
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Wert außerhalb des Bereichs
- **WHEN** eine Änderung `lat` 91 und `lon` 8 setzt
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Verortung entfernen
- **WHEN** eine Änderung `lat` und `lon` jeweils auf `null` setzt
- **THEN** trägt der Raum keine Koordinate mehr, und seine Anzeige enthält weder `lat` noch `lon`

#### Scenario: Verortung ändert keine anderen Angaben
- **WHEN** eine Änderung nur die Koordinate setzt, während eine andere Person zuvor den Standort geändert hat
- **THEN** bleibt der Standort auf dem zuletzt gespeicherten Stand

#### Scenario: Stornierter Raum
- **WHEN** an einem stornierten Raum eine Koordinate gesetzt werden soll
- **THEN** antwortet das System mit 409

#### Scenario: BR-Gerät
- **WHEN** ein gekoppeltes BR-Gerät die Koordinate seines Raums ändern will
- **THEN** antwortet das System mit 403 und ändert nichts

### Requirement: Verortung ohne Tagebucheintrag, aber live

Eine Änderung der Koordinate eines Bereitstellungsraums MUST keinen ETB-Eintrag schreiben, allein
wie zusammen mit anderen Raumdaten. Sie MUST als Änderung des Raums live an alle Personen mit
Lesezugriff auf das Modul Bereitstellungsräume verteilt werden (Ereignis `bereitstellungsraum`
mit der Kennung des Raums). ETB-Einträge des Moduls MUST NOT eine Koordinate enthalten.

#### Scenario: Nur Koordinate geändert
- **WHEN** ein Raum verortet wird und sonst nichts geändert wird
- **THEN** entsteht kein ETB-Eintrag
- **AND** Personen mit Lesezugriff auf das Modul Bereitstellungsräume erhalten ein Live-Ereignis zum Raum

#### Scenario: Inbetriebnahme nach Verortung
- **WHEN** ein verorteter Raum in Betrieb genommen wird
- **THEN** lautet der ETB-Eintrag wie bisher „Bereitstellungsraum <Bezeichnung> in Betrieb genommen“, ohne Koordinate

### Requirement: Lage-Snapshot und Schwärzung

Ein Lage-Snapshot SHALL die nicht stornierten Bereitstellungsräume des Einsatzes zum Zeitpunkt der
Aufnahme einfrieren, mit Status, Koordinate und Kennzahlen der Belegung. Beim Abruf MUST der
Snapshot diese Inhalte für Personen ohne Lesezugriff auf das Modul Bereitstellungsräume weglassen.
Ein Snapshot ohne dieses Feld MUST als „keine Räume“ gelten. Die Schwärzung eines Einsatzes MUST
die Koordinate der Räume als operatives Geo-Skelett erhalten.

#### Scenario: Snapshot ohne Modulrecht
- **WHEN** eine Person ohne Lesezugriff auf das Modul Bereitstellungsräume einen Snapshot abruft
- **THEN** enthält die Antwort keine Bereitstellungsräume

#### Scenario: Stand sichern ohne Modulrecht
- **WHEN** eine Person mit Schreibrecht auf die Lagekarte, aber ohne Lesezugriff auf das Modul Bereitstellungsräume einen Stand sichert oder Bezeichnung und Notiz eines Standes ändert
- **THEN** enthält auch diese Antwort keine Bereitstellungsräume, eingefroren werden sie trotzdem

#### Scenario: Schwärzung
- **WHEN** ein Einsatz geschwärzt wird
- **THEN** bleibt die Koordinate der Räume erhalten, während Standort und Notiz wie bisher geleert werden
