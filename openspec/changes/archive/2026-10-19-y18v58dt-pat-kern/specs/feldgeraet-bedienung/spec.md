## MODIFIED Requirements

### Requirement: Kein Lagebild auf der Platte

Ein Feldgerät SHALL kein Lagebild für den Offline-Betrieb auf der Platte speichern. Schreibvorgänge
ohne Netz MUST über die bestehende Offline-Warteschlange laufen. Das gilt für die Aufnahme und auch
für Nachsichtung, Verbleib, Verlaufsnotiz, Verletzung, Maßnahme und Transport einer Person, die das
Gerät schon geladen hat. Die Warteschlange MUST dafür die Eingaben der vorgemerkten Einträge halten,
auch Notiztexte, bis sie übertragen oder verworfen sind.

#### Scenario: Neuladen ohne Netz

- **WHEN** das Tablet ohne Netz neu geladen wird
- **THEN** zeigt es keine Patientendaten aus einem gespeicherten Stand

#### Scenario: Aufnahme ohne Netz

- **WHEN** das Tablet ohne Netz eine Person aufnimmt
- **THEN** steht die Aufnahme in der Warteschlange und wird bei Verbindung übertragen

#### Scenario: Nachsichtung ohne Netz

- **WHEN** das Tablet ohne Netz bei einer geöffneten Person eine Nachsichtung übernimmt
- **THEN** steht die Nachsichtung in der Warteschlange und wird bei Verbindung mit ihrer
  Erfassungszeit übertragen
