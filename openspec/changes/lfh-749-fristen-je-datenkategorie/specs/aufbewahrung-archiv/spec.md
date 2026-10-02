# Spec Delta

## MODIFIED Requirements

### Requirement: Archiv liest nur, bis auf das Wiederherstellen

Der Archiv-Namensraum SHALL ausschließlich lesende Abrufe anbieten, mit zwei Ausnahmen: dem
Wiederherstellen eines Einsatzes und dem Wiederherstellen einer Kategorie. Über ihn MUST sich
keine Angabe eines Einsatzes, einer
Person, eines Tiers, eines Schadens oder eines ETB-Eintrags ändern lassen. Die regulären
Einsatz-Routen MUST für einen gesperrten Einsatz weiter 403 liefern, auch dem System-Admin.
Das gilt für Detail, ETB, Personen, Tiere, Schäden, Anhänge, Dokumente, Chat, Lagekarte,
Export und Live-Strom.

#### Scenario: Reguläre Routen bleiben gesperrt
- **WHEN** der System-Admin nach der Schwärzung ETB, Personenliste, Anhänge oder Live-Strom des Einsatzes über die regulären Routen abruft
- **THEN** antwortet das System jeweils mit 403

#### Scenario: Kein Schreibweg im Archiv
- **WHEN** die Routen des Archiv-Namensraums aufgezählt werden
- **THEN** ist jede davon ein lesender Abruf, außer den beiden Wiederherstellen-Routen

## ADDED Requirements

### Requirement: Kategorien in Übersicht und Archivakte

Die Archivakte SHALL je Kategorie mit Kategorie-Frist Frist, Dauer, Rechtsgrundlage,
Sperrvermerk, Karenz-Ende, Zeitpunkt der Schwärzung und einen Zustand zeigen. Der Zustand folgt
denselben Regeln wie der des Einsatzes. Ein gesperrter Zustand heißt dort „gesperrt“ statt
„vorgemerkt“. Die Übersicht MUST je Einsatz die Zahl der gesperrten und geschwärzten Kategorien
zeigen. Für eine gesperrte Kategorie in der Karenz MUST die Akte das Wiederherstellen anbieten.

#### Scenario: Akte mit gesperrter Kategorie
- **WHEN** der Admin die Akte eines Einsatzes öffnet, dessen Personenauskunft seit 3 Tagen gesperrt ist
- **THEN** zeigt sie die Personenauskunft als gesperrt mit Karenz-Ende 27 Tage später
- **AND** bietet sie das Wiederherstellen der Kategorie an

#### Scenario: Ohne Kategorie-Fristen
- **WHEN** der Admin die Akte eines Einsatzes ohne Kategorie-Fristen öffnet
- **THEN** nennt sie, dass alle Daten der Einsatz-Frist folgen

#### Scenario: Übersicht
- **WHEN** die Organisation einen Einsatz mit einer gesperrten und einer geschwärzten Kategorie hat
- **THEN** zeigt seine Zeile in der Übersicht beide Zahlen
