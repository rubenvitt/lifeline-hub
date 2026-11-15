# Spec Delta

## ADDED Requirements

### Requirement: Tab-Titel einer Übung beginnt mit „ÜBUNG“

Ist der Einsatz eine Übung (Einsatzart „Übung“), SHALL der Tab-Titel jeder Route des
Einsatzrahmens mit „ÜBUNG · “ beginnen, vor einer Zählung ungelesener Eingänge.

#### Scenario: ETB in einer Übung

- **WHEN** eine Person `/einsaetze/5/etb` des Einsatzes „Starkregen Nord“ mit der Einsatzart
  „Übung“ öffnet
- **THEN** lautet der Tab-Titel „ÜBUNG · ETB · Starkregen Nord · lifeline-hub“

#### Scenario: Übung mit ungelesenen Eingängen

- **WHEN** in derselben Übung drei Eingänge ungelesen sind
- **THEN** lautet der Tab-Titel „ÜBUNG · (3) ETB · Starkregen Nord · lifeline-hub“
