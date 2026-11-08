# Spec Delta

## MODIFIED Requirements

### Requirement: Bearbeiten nur mit Recht am Datensatz
Bearbeiten SHALL je Element das Schreibrecht seines Datensatzes verlangen: Abschnitte das Recht auf
Abschnitte, Einheiten das auf Einheiten, die Führungsstelle das der Einsatzverwaltung, alles
Skizzeneigene und externe Stellen das auf das Fernmeldewesen. Ohne Recht MUST das Element keinen
Griff anbieten und im Paneel den Grund nennen. Ohne Schreibrecht im Einsatz MUST die Fläche
schreibgeschützt sein; Hervorheben, Filtern und Zoomen MUST weiter gehen. Der Server MUST jede
Änderung ohne Recht mit 403 ablehnen.

#### Scenario: Nur Leserecht
- **WHEN** eine Person ohne Schreibrecht im Einsatz die Skizze öffnet
- **THEN** kann sie nichts verschieben, zuordnen oder anlegen, aber Schienen hervorheben und zoomen

#### Scenario: Recht auf Fernmeldewesen, nicht auf Einheiten
- **WHEN** eine Person mit Schreibrecht auf das Fernmeldewesen, aber ohne Schreibrecht auf Einheiten
  „1. Zug“ auf eine Schiene ziehen will
- **THEN** bietet „1. Zug“ keinen Griff an, das Paneel nennt „Einheiten: kein Schreibrecht“, und
  ein direkter Aufruf wird mit 403 abgelehnt

#### Scenario: Stab ausgeblendet
- **WHEN** eine Person mit Schreibrecht auf das Fernmeldewesen eine externe Stelle anlegt
- **THEN** wird sie gespeichert und erscheint in der Skizze

#### Scenario: Recht auf Stab, nicht auf Einheiten
- **WHEN** eine Person mit Schreibrecht im Einsatz, aber ohne Freigabe des Fernmeldewesens die
  Lage eines Elements der Skizze direkt per API speichern will
- **THEN** lehnt der Server mit 403 ab, und nichts wird gespeichert
