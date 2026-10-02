# Spec Delta

## MODIFIED Requirements

### Requirement: Manuelle Frist

Einsatzleitung und System-Admin SHALL die Frist eines Einsatzes setzen, ändern und aufheben
können, vor und nach dem Abschluss. Als System-Admin MUST er das nur an Einsätzen seiner
eigenen Organisation können; eine Mitgliedschaft als Einsatzleitung trägt unabhängig von der
Organisation. Andere Personen MUST 403 erhalten, auch der System-Admin einer fremden
Organisation ohne diese Mitgliedschaft, und dabei MUST sich weder Frist noch ETB ändern. Eine Verkürzung MUST
ausdrücklich bestätigt werden, sonst antwortet das System mit 409. Als Verkürzung gilt ein
früherer Zeitpunkt oder das erstmalige Setzen einer Frist an einem Einsatz ohne Frist. Eine
unveränderte Frist MUST ohne Schreibvorgang und ohne ETB-Eintrag bleiben. Jede wirksame
Änderung MUST einen System-Eintrag im ETB mit altem und neuem Wert schreiben. An einem zur
Löschung vorgemerkten Einsatz, dessen Karenz noch läuft, MUST die Änderung mit 422 abgewiesen
werden, mit dem Hinweis auf das Wiederherstellen. Ist die Karenz abgelaufen, der Einsatz aber
noch nicht geschwärzt, MUST sie mit 409 abgewiesen werden, ohne Hinweis auf das
Wiederherstellen, denn auch das ist dann ausgeschlossen. An einem geschwärzten Einsatz MUST sie
mit 409 abgewiesen werden. Nach Fristablauf bietet die Oberfläche der Einsatzleitung keinen
eigenen Weg zum Verlängern; bis zur Vormerkung bleibt die Änderung für sie zulässig. Ist der
Einsatz vorgemerkt, MUST das Wiederherstellen des Org-Admins der einzige Weg bleiben.

#### Scenario: Verlängern ohne Bestätigung
- **WHEN** die Einsatzleitung die Frist eines abgeschlossenen Einsatzes auf einen späteren Zeitpunkt setzt
- **THEN** gilt die neue Frist, und das ETB nennt alten und neuen Wert

#### Scenario: Verkürzen ohne Bestätigung
- **WHEN** eine Frist auf einen früheren Zeitpunkt gesetzt wird, ohne Bestätigung
- **THEN** antwortet das System mit 409 und ändert nichts

#### Scenario: Admin einer fremden Organisation
- **WHEN** der System-Admin einer anderen Organisation ohne Mitgliedschaft die Frist eines aktiven oder eines abgeschlossenen Einsatzes ändern will
- **THEN** antwortet das System mit 403
- **AND** bleiben Frist und ETB unverändert

#### Scenario: Admin einer fremden Organisation als Einsatzleitung
- **WHEN** der System-Admin einer anderen Organisation, der im Einsatz Einsatzleitung ist, die Frist ändert
- **THEN** gilt die neue Frist

#### Scenario: Admin der eigenen Organisation nach Fristablauf
- **WHEN** der System-Admin der Einsatz-Org ohne Mitgliedschaft die abgelaufene Frist eines abgeschlossenen, noch nicht vorgemerkten Einsatzes in die Zukunft verlegt
- **THEN** gilt die neue Frist

#### Scenario: Vorgemerkter Einsatz
- **WHEN** an einem zur Löschung vorgemerkten Einsatz die Frist geändert werden soll
- **THEN** antwortet das System mit 422, und Frist und Vormerkung bleiben unverändert

#### Scenario: Karenz abgelaufen, noch nicht geschwärzt
- **WHEN** an einem vorgemerkten Einsatz, dessen Karenz abgelaufen ist, die Frist geändert werden soll
- **THEN** antwortet das System mit 409, und Frist und Vormerkung bleiben unverändert

#### Scenario: Geschwärzter Einsatz
- **WHEN** an einem geschwärzten Einsatz die Frist geändert werden soll
- **THEN** antwortet das System mit 409
