# Spec Delta

## MODIFIED Requirements

### Requirement: Presse-Log bearbeiten, nicht löschen
Medium, Thema, Ansprechperson, Erreichbarkeit und Eingang eines Medienkontakts SHALL sich
bearbeiten lassen. Ein Medienkontakt MUST NOT gelöscht werden können. Während des Einsatzes ist
das Log der Arbeitsstand der Pressearbeit; über die Schwärzung hinaus bleibt als Nachweis nur die
freigegebene Pressemitteilung im ETB.

#### Scenario: Kein Löschen
- **WHEN** eine Person versucht, einen Medienkontakt zu löschen
- **THEN** bietet die Oberfläche keine solche Aktion an, und das System hat keinen Endpunkt dafür

### Requirement: Datenschutz der Kontaktdaten
Ansprechperson und Erreichbarkeit MUST als personenbezogen gelten. Die Schwärzung eines Einsatzes
MUST beide entfernen, ebenso die Freitexte des Presse-Logs: Medium, Thema, Antwort und
Freigabeangabe. Erhalten bleiben MUST Art, Status, Eingang, Bearbeitungs- und Änderungszeitpunkte
sowie die Verweise auf Benutzer und auf die Pressemitteilung. Der System-Eintrag der Schwärzung MUST die Freitexte des
Presse-Logs als entfernt nennen. Medienkontakte MUST NOT im Offline-Lagebild auf dem Gerät
gespeichert werden.

#### Scenario: Schwärzung
- **WHEN** ein Einsatz mit einer beantworteten Anfrage „Anfrage zu Fam. Yilmaz“ von „NDR 1“ mit
  Ansprechperson, Antwort und Freigabeangabe geschwärzt wird
- **THEN** sind Ansprechperson, Erreichbarkeit und Freigabeangabe leer
- **AND** tragen Medium, Thema und Antwort den Platzhalter
- **AND** stehen Art, Status und Eingang unverändert da

#### Scenario: Unbeantworteter Kontakt
- **WHEN** ein Einsatz mit einem offenen Medienkontakt ohne Antwort geschwärzt wird
- **THEN** bleibt die Antwort leer und die Schwärzung läuft durch

#### Scenario: Audit nennt das Presse-Log
- **WHEN** ein Einsatz geschwärzt wird
- **THEN** nennt der System-Eintrag der Schwärzung die Freitexte des Presse-Logs unter dem
  Entfernten

#### Scenario: Kein Offline-Vorrat
- **WHEN** das Lagebild für die Offline-Lesbarkeit gespeichert wird
- **THEN** enthält der gespeicherte Stand keine Medienkontakte
