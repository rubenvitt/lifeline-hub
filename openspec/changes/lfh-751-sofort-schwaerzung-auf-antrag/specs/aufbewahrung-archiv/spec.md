# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: Archiv liest nur, bis auf das Wiederherstellen`
- TO: `### Requirement: Archiv liest nur, bis auf Wiederherstellen und Schwärzungsantrag`

## MODIFIED Requirements

### Requirement: Zugriff nur für den Org-Admin

Übersicht, Archivakte, Wiederherstellen, Schwärzungsanträge und Personensuche SHALL nur einem
System-Admin (`system_rolle = admin`) offenstehen, und nur für Einsätze seiner eigenen
Organisation. Andere Personen MUST 403 erhalten, auch Einsatzleitung und org-weite
Führungskraft. Ein Einsatz einer fremden Organisation MUST 403 liefern, ein unbekannter Einsatz
404. Für einen aktiven Einsatz gibt es keine Archivakte, das System MUST mit 409 antworten.

#### Scenario: Admin der eigenen Organisation
- **WHEN** ein System-Admin die Archivakte eines geschwärzten Einsatzes seiner Organisation abruft
- **THEN** antwortet das System mit 200

#### Scenario: Führungskraft
- **WHEN** eine org-weite Führungskraft Übersicht oder Archivakte abruft
- **THEN** antwortet das System mit 403

#### Scenario: Einsatzleitung des gesperrten Einsatzes
- **WHEN** die Einsatzleitung eines vorgemerkten Einsatzes dessen Archivakte abruft
- **THEN** antwortet das System mit 403

#### Scenario: Fremde Organisation
- **WHEN** ein System-Admin die Archivakte eines Einsatzes einer anderen Organisation abruft
- **THEN** antwortet das System mit 403

#### Scenario: Aktiver Einsatz
- **WHEN** ein System-Admin die Archivakte eines aktiven Einsatzes abruft
- **THEN** antwortet das System mit 409

#### Scenario: Personensuche durch die Einsatzleitung
- **WHEN** die Einsatzleitung eines abgeschlossenen Einsatzes die Personensuche des Archivs aufruft
- **THEN** antwortet das System mit 403

### Requirement: Archiv liest nur, bis auf Wiederherstellen und Schwärzungsantrag

Der Archiv-Namensraum SHALL ausschließlich lesende Abrufe anbieten, mit drei Ausnahmen: dem
Wiederherstellen, dem Stellen eines Schwärzungsantrags und seiner Rücknahme. Die Personensuche
ist ein lesender Abruf, auch wenn sie ihren Suchtext im Anfrage-Body trägt. Über den Namensraum
MUST sich keine Angabe eines Einsatzes, einer Person, eines Tiers, eines Schadens oder eines
ETB-Eintrags unmittelbar ändern lassen; geschwärzt wird nur durch den Vollzug im Purge-Lauf. Die
regulären Einsatz-Routen MUST für einen gesperrten Einsatz weiter 403 liefern, auch dem
System-Admin. Das gilt für Detail, ETB, Personen, Tiere, Schäden, Anhänge, Dokumente, Chat,
Lagekarte, Export und Live-Strom.

#### Scenario: Reguläre Routen bleiben gesperrt
- **WHEN** der System-Admin nach der Schwärzung ETB, Personenliste, Anhänge oder Live-Strom des Einsatzes über die regulären Routen abruft
- **THEN** antwortet das System jeweils mit 403

#### Scenario: Kein Schreibweg im Archiv
- **WHEN** die Routen des Archiv-Namensraums aufgezählt werden
- **THEN** ist jede davon ein lesender Abruf, außer Wiederherstellen, Antrag und Rücknahme
- **AND** ist die Personensuche als einzige lesende Route kein GET

#### Scenario: Antrag ändert keine Angabe
- **WHEN** der Admin einen Schwärzungsantrag für eine Person stellt
- **THEN** trägt die Person unmittelbar danach unveränderte Angaben

### Requirement: Aufbewahrungsübersicht

Die Übersicht SHALL alle abgeschlossenen Einsätze der Organisation des Admins zeigen, jeweils
mit Einsatznummer, Bezeichnung, Abschlusszeitpunkt, Frist, Zeitpunkt der Vormerkung,
Karenz-Ende, Fälligkeit eines offenen Einsatz-Antrags, Zeitpunkt der Schwärzung und einem
Aufbewahrungszustand. Der Zustand MUST genau einer dieser Werte sein, in dieser Rangfolge:
- `geschwaerzt`
- `schwaerzung_beantragt`: offener Einsatz-Antrag, noch nicht vollzogen
- `schwaerzung_ausstehend`: Karenz abgelaufen, noch nicht geschwärzt
- `vorgemerkt`: vorgemerkt, Karenz läuft
- `faellig`: Frist abgelaufen, noch nicht vorgemerkt
- `frist_laeuft`: Frist in der Zukunft
- `ohne_frist`: keine Frist gesetzt

Aktive Einsätze MUST fehlen. Die Übersicht MUST ohne Schreibvorgang auskommen und keine
personenbezogenen Spalten enthalten. Ein offener Personen-Antrag ändert den Zustand nicht.

#### Scenario: Zustände
- **WHEN** die Organisation je einen abgeschlossenen Einsatz ohne Frist, mit künftiger Frist, mit abgelaufener Frist, vorgemerkt seit 3 Tagen, vorgemerkt seit 31 Tagen und geschwärzt hat
- **THEN** zeigt die Übersicht sie mit den Zuständen `ohne_frist`, `frist_laeuft`, `faellig`, `vorgemerkt`, `schwaerzung_ausstehend` und `geschwaerzt`
- **AND** trägt der vorgemerkte Einsatz ein Karenz-Ende 30 Tage nach seiner Vormerkung

#### Scenario: Offener Einsatz-Antrag
- **WHEN** ein Einsatz mit künftiger Frist einen vor 2 Stunden gestellten Einsatz-Antrag trägt
- **THEN** zeigt die Übersicht ihn als `schwaerzung_beantragt` mit einer Fälligkeit 24 Stunden nach dem Antrag

#### Scenario: Zurückgenommener Antrag
- **WHEN** der Einsatz-Antrag zurückgenommen ist
- **THEN** zeigt die Übersicht wieder den Zustand aus Frist und Vormerkung

#### Scenario: Fremde Organisation und aktive Einsätze
- **WHEN** es aktive Einsätze der eigenen und abgeschlossene Einsätze einer fremden Organisation gibt
- **THEN** fehlen beide in der Übersicht
