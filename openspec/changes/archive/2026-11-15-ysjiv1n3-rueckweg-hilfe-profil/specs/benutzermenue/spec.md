# Spec Delta

## ADDED Requirements

### Requirement: Hilfe aus dem Einsatz neben dem Einsatz

Wird „Hilfe“ im Benutzermenü auf einer Seite des Einsatzrahmens ab der Breite `lg` mit feinem
Zeiger gewählt, SHALL die Hilfe in einem neuen Tab öffnen, in der Desktop-App in einem
Nebenfenster; der Einsatz MUST im bisherigen Tab an derselben Stelle bleiben. Unter `lg`, mit
grobem Zeiger (Tablet) und außerhalb des Einsatzrahmens SHALL die Hilfe im selben Tab öffnen.
Der Rückmeldeweg der Hilfe MUST in beiden Fällen den Bereich nennen, aus dem sie geöffnet wurde.

#### Scenario: Hilfe am Fükw-Rechner

- **WHEN** eine Person bei 1440 × 900 im ETB eines Einsatzes im Benutzermenü „Hilfe“ wählt
- **THEN** öffnet die Hilfe in einem neuen Tab
- **AND** der bisherige Tab zeigt weiter das ETB

#### Scenario: Hilfe am Handy

- **WHEN** eine Person bei 390 × 844 im ETB eines Einsatzes im Benutzermenü „Hilfe“ wählt
- **THEN** öffnet die Hilfe im selben Tab mit „Zurück zu <Einsatz>“

#### Scenario: Hilfe am Führungs-Tablet

- **WHEN** eine Person an einem Tablet mit Finger bei 1180 × 820 im ETB eines Einsatzes im Benutzermenü „Hilfe“ wählt
- **THEN** öffnet die Hilfe im selben Tab mit „Zurück zu <Einsatz>“

#### Scenario: Hilfe außerhalb des Einsatzes

- **WHEN** eine Person auf der Einsatzliste bei 1440 × 900 im Benutzermenü „Hilfe“ wählt
- **THEN** öffnet die Hilfe im selben Tab

#### Scenario: Rückmeldung aus der Hilfe im neuen Tab

- **WHEN** die Hilfe aus dem ETB in einem neuen Tab geöffnet wurde und dort nach einem Kapitelwechsel „Rückmeldung geben“ gewählt wird
- **THEN** trägt das Formular den Bereich `/einsaetze/:id/etb`
- **AND** die Adresse der Hilfe trägt die Herkunft nicht mehr, sobald die Seite steht
