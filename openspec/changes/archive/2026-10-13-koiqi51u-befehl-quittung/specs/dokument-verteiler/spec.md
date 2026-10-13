# Spec Delta

## MODIFIED Requirements

### Requirement: Fortschreiben übernimmt den Verteiler
Das Fortschreiben eines freigegebenen Dokuments SHALL den Verteiler mit Reihenfolge, Zielen und
Anzeigenamen in die neue Entwurfsfassung übernehmen, im selben Schreibvorgang. Quittungen der
freigegebenen Fassung MUST NOT übernommen werden: jeder Eintrag der neuen Fassung beginnt offen.
Der Verteiler der freigegebenen Fassung MUST unverändert bleiben, wenn der neue Entwurf geändert
wird.

#### Scenario: Neue Fassung
- **WHEN** ein freigegebener Lagebericht mit dem Verteiler „Leitstelle, EA Nord“ fortgeschrieben wird
- **THEN** trägt Fassung 2 den Verteiler „Leitstelle, EA Nord“

#### Scenario: Änderung an der neuen Fassung
- **WHEN** jemand den Verteiler von Fassung 2 leert
- **THEN** behält Fassung 1 ihren Verteiler

#### Scenario: Quittung bleibt an der alten Fassung
- **WHEN** ein freigegebener Befehl, bei dem „EA Süd“ quittiert hat, fortgeschrieben wird
- **THEN** ist „EA Süd“ in Fassung 2 offen, und in Fassung 1 bleibt die Quittung stehen

## ADDED Requirements

### Requirement: Die Liste der Befehle trägt den Verteiler
Die Liste der Einsatzbefehle SHALL je Befehl den Verteiler in Reihenfolge tragen, mit Art, Ziel,
Anzeigenamen und dem Zeitpunkt einer Quittung, dazu die Angabe, ob der Befehl quittierbar ist.
Die Liste der Lageberichte MUST unverändert bleiben.

#### Scenario: Liste mit Verteiler
- **WHEN** ein freigegebener Befehl den Verteiler „EA Süd, S3 Einsatz“ trägt und „EA Süd“ quittiert hat
- **THEN** nennt die Liste der Befehle für ihn „EA Süd“ mit Zeitpunkt der Quittung und „S3 Einsatz“ ohne
