## MODIFIED Requirements

### Requirement: Einzelerfassung und Serienaufnahme bleiben getrennte Einstiege

Die Schnellaktion „Person erfassen“ der Sprungpalette SHALL auf die Personenliste mit der
Erfassungsmaske führen, also auf die Einzelerfassung. Die Sprungpalette MUST NOT einen eigenen
Befehl für die Aufnahme-Route (Serienbetrieb) führen.

#### Scenario: Palette führt zur Einzelerfassung

- **WHEN** eine Person in der Sprungpalette „Person erfassen“ ausführt
- **THEN** öffnet sich die Personenliste mit der Erfassungsmaske
- **AND** nicht die Aufnahme-Route
