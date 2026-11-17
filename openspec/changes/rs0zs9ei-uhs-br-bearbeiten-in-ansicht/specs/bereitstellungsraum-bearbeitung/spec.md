# Spec Delta

## Purpose

Regelt, wie die Raumdaten eines Bereitstellungsraums (Bezeichnung, Standort, Notiz) in seiner
Ansicht geändert werden und wie der Speicherweg verhindert, dass eine Änderung die eines anderen
Arbeitsplatzes still überschreibt.

## ADDED Requirements

### Requirement: Raumdaten im Paneel bearbeiten
Die Detailseite eines Bereitstellungsraums SHALL seine Raumdaten (Bezeichnung, Standort, Notiz) im
Paneel „Raumdaten“ zeigen. Wer Räume verwalten darf, MUST sie über „Bearbeiten“ im Paneelkopf an
ihrer Stelle ändern können, solange der Raum weder aufgelöst noch storniert ist; „Speichern“ und
„Abbrechen“ stehen im Paneelfuß. Einen Dialog dafür MUST es nicht geben.

#### Scenario: Standort ändern
- **WHEN** eine Person mit Verwaltungsrecht im Paneel „Raumdaten“ „Bearbeiten“ wählt, den Standort
  „Parkplatz P3“ einträgt und „Speichern“ wählt
- **THEN** zeigt das Paneel den Standort „Parkplatz P3“, und kein Dialog hat sich geöffnet

#### Scenario: Aufgelöster Raum
- **WHEN** jemand einen aufgelösten Raum öffnet
- **THEN** zeigt das Paneel „Raumdaten“ die Angaben ohne „Bearbeiten“

### Requirement: Auf Karte verorten im Paneelkopf
„Auf Karte verorten“ SHALL im Kopf des Paneels „Raumdaten“ vor „Bearbeiten“ stehen, solange das
Paneel nicht bearbeitet wird und der Raum bearbeitbar ist.

#### Scenario: Während der Bearbeitung
- **WHEN** das Paneel „Raumdaten“ im Bearbeiten-Zustand steht
- **THEN** ist „Auf Karte verorten“ nicht zu sehen, und nach „Abbrechen“ steht es wieder vor
  „Bearbeiten“

### Requirement: Speichern sendet nur Geändertes mit Basisstand
Das Speichern der Raumdaten SHALL nur die geänderten Angaben senden, zusammen mit dem Stand, der
beim Öffnen galt. Ein geleertes optionales Feld MUST als `null` gehen; die Koordinate des Standorts
MUST nur als Paar und nur bei einer Änderung gehen.

#### Scenario: Nur die Notiz
- **WHEN** im offenen Paneel nur die Notiz geändert und gespeichert wird
- **THEN** enthält der Aufruf die Notiz und den Basisstand, aber weder Bezeichnung noch Standort

### Requirement: Kollisionsschutz beim Speichern der Raumdaten
`PATCH /api/einsaetze/{id}/bereitstellungsraeume/{bid}` SHALL ein optionales Feld
`basis_geaendert_at` annehmen. Weicht der gespeicherte Stand davon ab, MUST der Server mit 409
antworten und nichts ändern. Fehlt das Feld, MUST er wie bisher schreiben. Den Sperrkonflikt
MUST der Server mit `grund: "veraltet"` auszeichnen; nur auf ihn MUST die Oberfläche
„Zwischenzeitlich geändert“ fragen.

#### Scenario: Veralteter Stand
- **WHEN** ein PATCH mit `basis_geaendert_at` eines älteren Stands die Notiz ändern will
- **THEN** antwortet der Server mit 409, und die Notiz bleibt unverändert

#### Scenario: Aktueller Stand
- **WHEN** ein PATCH mit dem aktuellen `basis_geaendert_at` die Notiz ändert
- **THEN** speichert der Server die Notiz und liefert den Raum mit neuem `geaendert_at`

#### Scenario: Ohne Basisstand
- **WHEN** die Lagekarte den Raum verortet und dabei kein `basis_geaendert_at` sendet
- **THEN** speichert der Server die Koordinate ohne Prüfung des Stands

#### Scenario: Doppelte Bezeichnung ist kein Sperrkonflikt
- **WHEN** an „BR West“ die Bezeichnung „BR Ost“ gespeichert wird, die im Einsatz schon vergeben ist
- **THEN** antwortet der Server mit 409 ohne `grund: "veraltet"`, und das Paneel zeigt den Grund
  statt „Zwischenzeitlich geändert“; die Eingabe bleibt stehen

#### Scenario: Rückfrage in der Oberfläche
- **WHEN** nach dem Öffnen des Paneels ein anderer Arbeitsplatz den Standort speichert und hier
  danach die Notiz gespeichert wird
- **THEN** fragt die Seite „Zwischenzeitlich geändert“; „Meine Änderung übernehmen“ speichert die
  Notiz ohne Basisstand
