# Spec Delta

## ADDED Requirements

### Requirement: Aufgefächertes Bündel bleibt bei reiner Inhaltsänderung offen
Ändern sich bei offenem Bündel nur Eigenschaften der Marker (Farbe, Kurzzeichen, Beschriftung,
Status), nicht aber ihre Menge, Reihenfolge oder Lage, SHALL die Karte das Bündel aufgefächert
lassen. Die Blätter MUST an ihrer Stelle bleiben und die neuen Eigenschaften zeigen. Ändern sich
Menge, Reihenfolge oder Lage, MUST das Bündel wie bisher zuklappen.

#### Scenario: Sichtung ändert sich bei offenem Bündel
- **WHEN** ein Personen-Bündel aufgefächert ist und live die Sichtung eines seiner Blätter wechselt
- **THEN** bleibt das Bündel offen, das Blatt steht an derselben Stelle und zeigt die neue Sichtung, und ein Tipp darauf öffnet die Person

#### Scenario: Status eines Fahrzeugs ändert sich bei offenem Bündel der Lagekarte
- **WHEN** auf der Lagekarte ein Bündel aufgefächert ist und live der Status eines seiner Fahrzeuge wechselt
- **THEN** bleibt das Bündel offen und zeigt den neuen Status

#### Scenario: Zugang klappt das Bündel zu
- **WHEN** ein Bündel aufgefächert ist und live ein Marker hinzukommt oder seine Lage ändert
- **THEN** klappt das Bündel zu
