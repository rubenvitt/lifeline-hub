# Spec Delta

## ADDED Requirements

### Requirement: Eine übernommene Nachlieferung frischt die Stammdaten

Übernimmt eine Instanz eine Nachlieferung von Stammdaten aus einer Kopplung (Fähigkeit
`stammdaten-verteilung`), die mindestens eine Zeile ändert, SHALL sie nach dem Commit das
Ereignis `stammdaten` an die zugeordnete Organisation verteilen. Auch hier MUST die Nutzlast leer
sein (`{}`). Eine Nachlieferung ohne Änderung MUST NOT das Ereignis auslösen.

#### Scenario: Neues Fahrzeug vom Hub
- **WHEN** ein ELW mit einer Meldung ein neues Fahrzeug vom Hub übernimmt und ein Schirm am ELW eine Fahrzeugauswahl offen hat
- **THEN** zeigt der Schirm das neue Fahrzeug ohne Neuladen

#### Scenario: Leere Nachlieferung
- **WHEN** eine Meldung keine geänderten Stammdaten bringt
- **THEN** wird kein Ereignis `stammdaten` verteilt
