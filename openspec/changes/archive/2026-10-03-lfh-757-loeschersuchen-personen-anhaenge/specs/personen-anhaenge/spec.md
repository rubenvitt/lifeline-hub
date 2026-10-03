## ADDED Requirements

### Requirement: Löschersuchen löscht die Dateien der Person

Der Vollzug eines Löschersuchens nach Art. 17 für eine betroffene Person MUST alle an ihr
abgelegten Dateien samt Verknüpfung löschen, auch bereits entfernte. Dateien anderer Personen und
anderer Einsätze MUST unverändert bleiben. Die pseudonymen Einträge im Einsatztagebuch und das
Zugriffsprotokoll MUST erhalten bleiben. Die Rückfrage vor dem Antrag MUST nennen, dass Fotos und
Dateien der Person mitgehen.

#### Scenario: Antrag für R-001
- **WHEN** an R-001 eine Datei abgelegt und eine entfernt ist, an R-002 eine abgelegt ist, und das Löschersuchen für R-001 vollzogen wird
- **THEN** gibt es für R-001 keine gespeicherte Datei und keine Verknüpfung mehr, die Datei von R-002 liegt weiter vor, und die Einträge „Person R-001: … abgelegt/entfernt“ stehen weiter im Einsatztagebuch

#### Scenario: Rückfrage nennt die Dateien
- **WHEN** der Admin das Löschersuchen für eine betroffene Person öffnet
- **THEN** nennt die Rückfrage „ihre Fotos und Dateien“ unter dem, was entfernt wird
