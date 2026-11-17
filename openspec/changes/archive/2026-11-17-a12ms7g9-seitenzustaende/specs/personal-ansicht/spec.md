# Spec Delta

## MODIFIED Requirements

### Requirement: Ansicht ohne Person oder ohne Schreibrecht

Eine ungültige ID, eine unbekannte oder eine stornierte Person MUST die Ansicht als nicht (mehr)
im Einsatz melden, mit einem Weg zur Personalliste, ohne stille Weiterleitung. Ohne Schreibrecht
oder bei abgeschlossenem Einsatz MUST die Ansicht nur lesen und den Grund nennen.

#### Scenario: Stornierte Person
- **WHEN** die Ansicht einer stornierten Person aufgerufen wird
- **THEN** meldet die Seite, dass die Person nicht (mehr) im Einsatz ist, und bietet den Weg zur Personalliste

#### Scenario: Abgeschlossener Einsatz
- **WHEN** die Ansicht in einem abgeschlossenen Einsatz geöffnet wird
- **THEN** stehen alle Angaben als Text, und die Seite nennt den Grund „nur Ansicht“

#### Scenario: Ungültige ID
- **WHEN** die Ansicht mit einer Kennung aufgerufen wird, die keine Zahl ist
- **THEN** bleibt die Adresse stehen, und die Seite meldet die Person als nicht (mehr) im Einsatz
  mit dem Weg zur Personalliste
