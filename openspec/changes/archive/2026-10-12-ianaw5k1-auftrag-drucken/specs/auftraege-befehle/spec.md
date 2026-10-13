# Spec Delta

## ADDED Requirements

### Requirement: Druckansicht aus dem Detail eines Auftrags

Das Detail eines Auftrags SHALL einen Sprung „Druckansicht“ tragen, der die Druckansicht dieses
Auftrags öffnet. Der Sprung MUST unabhängig vom Schreibrecht und von der Phase des Auftrags
stehen, auch an einem aufgehobenen Auftrag.

#### Scenario: Beobachter druckt einen Auftrag

- **WHEN** eine Person ohne Schreibrecht im Einsatz einen Auftrag im Detail öffnet und
  „Druckansicht“ wählt
- **THEN** öffnet sich die Druckansicht dieses Auftrags mit „Drucken / als PDF“

#### Scenario: Rückweg aus der Druckansicht

- **WHEN** in der Druckansicht eines Auftrags „Zurück zu Aufträge/Befehle“ gewählt wird
- **THEN** steht der Reiter „Einzelaufträge“ mit diesem Auftrag gewählt
