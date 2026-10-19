## MODIFIED Requirements

### Requirement: Rückfrage vor dem Verlassen
Hat eine Formularseite mit Speichern-Leiste ungespeicherte Änderungen oder hat in einer Ansicht
ein offenes Einzelfeld einen geänderten, ungespeicherten Entwurf, SHALL jeder Wechsel auf
einen anderen Pfad innerhalb der App (Seitenmenü, Segmentleiste, Brotkrume, Link) angehalten
werden. Die Seite MUST nachfragen und „Bleiben“ und „Verwerfen“ anbieten. „Bleiben“ MUST die
Eingaben erhalten, „Verwerfen“ MUST den Wechsel ausführen.

#### Scenario: Reiterwechsel in den Einsatz-Einstellungen
- **WHEN** jemand mit Schreibrecht in „Allgemein“ ein Feld ändert und ohne Speichern den Reiter „Verhalten & Automatik“ wählt
- **THEN** erscheint die Rückfrage, und nach „Bleiben“ steht die Eingabe unverändert im Feld

#### Scenario: Verwerfen führt den Wechsel aus
- **WHEN** auf dem Fahrzeug-Detail das Kennzeichen geändert, ein anderer Menüpunkt gewählt und „Verwerfen“ bestätigt wird
- **THEN** wechselt die Seite zum gewählten Ziel

#### Scenario: Offenes Einzelfeld in einer Ansicht
- **WHEN** im Personen-Detail der Name geöffnet und geändert ist und jemand die Brotkrume „Betroffene“ wählt
- **THEN** erscheint die Rückfrage, und nach „Verwerfen“ wechselt die Seite in die Betroffenenliste
