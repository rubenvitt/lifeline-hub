# personen-massnahmen Specification

## Purpose
Maßnahmen am Patienten mit festem Katalog und Uhrzeit, nur anhängend und genau einmal aufhebbar.
Die Führung sieht damit, was an einem Patienten schon getan ist. Die App leitet aus Maßnahmen
nichts ab.

## Requirements

### Requirement: Maßnahme erfassen

Wer im Einsatz Schreibrecht auf das Modul Personen hat, SHALL an einer angetroffenen Person eine
Maßnahme aus dem festen Katalog erfassen können: `blutstillung`, `zugang`, `infusion`,
`sauerstoff`, `atemweg`, `analgesie`, `immobilisation`, `waermeerhalt`, `dekontamination`. Die
Uhrzeit der Durchführung MUST optional sein. Ohne Angabe gilt der Zeitpunkt der Erfassung. Die
Uhrzeit MAY vor dem Anlegen der Person liegen und MUST dann unverändert gelten. Liegt sie vor dem
Beginn des Einsatzes (oder, falls das Anlegen früher liegt, vor dem Anlegen), MUST der Server mit
400 ablehnen und nichts speichern. Nach oben gilt die Kappung der Spec `personen-verlauf`. Ein
unbekannter Katalogwert MUST 400 ergeben. Eine stornierte Person MUST 409 ergeben, eine vermisste
oder abgemeldete 422.

Die App MUST aus Maßnahmen nichts ableiten: keine Sichtungskategorie, keine Empfehlung, keine
Warnung.

#### Scenario: Tourniquet um 14:05
- **WHEN** jemand an R-012 „Blutstillung“ mit Uhrzeit 14:05 erfasst
- **THEN** liefert das Detail von R-012 die Maßnahme mit 14:05, Erfasser und Erfassungszeit

#### Scenario: Tourniquet am Fundort vor der Registrierung
- **WHEN** um 13:50 am Fundort ein Tourniquet angelegt, die Person um 14:00 registriert und danach
  „Blutstillung“ mit Uhrzeit 13:50 erfasst wird
- **THEN** trägt die Maßnahme 13:50

#### Scenario: Uhrzeit vor dem Einsatzbeginn
- **WHEN** eine Maßnahme mit einer Uhrzeit vor dem Beginn des Einsatzes erfasst wird
- **THEN** antwortet der Server mit 400 und speichert nichts

#### Scenario: Ohne Uhrzeit
- **WHEN** eine Maßnahme ohne Uhrzeit erfasst wird
- **THEN** trägt sie den Zeitpunkt der Erfassung

### Requirement: Maßnahme aufheben statt löschen

Eine Maßnahme SHALL sich genau einmal aufheben lassen, mit Zeitpunkt und Aufhebendem. Ein zweites
Aufheben MUST 409 ergeben, auch bei gleichzeitigen Anfragen. Das Detail MUST aufgehobene Maßnahmen
als solche liefern. Weil das Aufheben keinen Rückweg hat, MUST die Oberfläche vor dem Senden
zurückfragen.

#### Scenario: Irrtum korrigieren
- **WHEN** eine versehentlich erfasste „Infusion“ aufgehoben wird
- **THEN** steht sie im Verlauf als aufgehoben, und der Patientenkopf zählt sie nicht mehr

#### Scenario: Fehltipp auf „Aufheben“
- **WHEN** jemand im Maßnahme-Paneel auf „Aufheben“ tippt und die Rückfrage verneint
- **THEN** wird nichts gesendet, und die Maßnahme bleibt gültig

### Requirement: Maßnahmen bleiben aus ETB und Live-Kanal heraus

Erfassen und Aufheben einer Maßnahme SHALL keinen ETB-Eintrag schreiben. Das Live-Ereignis MUST nur
Einsatz und Person nennen.

#### Scenario: Leak-Probe
- **WHEN** an einer Person „Analgesie“ erfasst wird
- **THEN** enthält weder das ETB noch ein Live-Ereignis die Maßnahme

### Requirement: Maßnahmen am UHS-Gerät

Ein Gerät mit UHS-Ansicht SHALL Maßnahmen an Personen seiner UHS erfassen und aufheben können, mit
optionaler Angabe „Bestätigt von“. Eine Person einer fremden UHS MUST 404 ergeben, Betreuungsstelle
und Lagemonitor MUST 403 erhalten.

#### Scenario: Bestätigte Maßnahme
- **WHEN** das Tablet der UHS Nord „Sauerstoff“ mit „bestätigt von Dr. A. Muster“ erfasst
- **THEN** nennt der Verlauf der Person die bestätigende Person
