## MODIFIED Requirements

### Requirement: Katalog der Funktionsansichten

Das System SHALL genau diese Funktionsansichten kennen: `uhs-tablet`, `uhs-laptop`,
`lagemonitor`, `betreuungsstelle`, `bereitstellungsraum`, `einsatzabschnitt`, `verpflegung`,
`stab-sachgebiet` und `stabsmonitor`.

Die Bindung je Ansicht ist:
- Die beiden UHS-Ansichten MUST an genau eine UHS des Einsatzes gebunden sein.
- `betreuungsstelle` MUST an genau eine Betreuungsstelle gebunden sein, `bereitstellungsraum` an
  genau einen Bereitstellungsraum, `einsatzabschnitt` an genau einen Einsatzabschnitt.
- `stab-sachgebiet` MUST an genau ein Sachgebiet `s1` bis `s6` gebunden sein (Fähigkeit
  `stab-fachzugang`).
- `verpflegung` MAY an genau eine Verpflegungsstelle des Einsatzes gebunden sein; ohne Stelle MUST
  sie einsatzweit gelten (LLH-1048).
- `lagemonitor` und `stabsmonitor` MUST an keine Stelle gebunden sein.

Beim Anlegen einer Kopplung MUST der Server mit 400 antworten bei:
- einem unbekannten Ansichtswert
- einer fehlenden Stelle bei einer Ansicht mit Pflichtstelle
- einem unbekannten Sachgebiet
- einer angegebenen Stelle bei Lagemonitor oder Stabsmonitor

Die Übersicht der Kopplungen MUST je Ansicht die Art ihrer Stelle nennen und ob die Stelle Pflicht
ist.

#### Scenario: Unbekannte Ansicht

- **WHEN** die Einsatzleitung eine Kopplung mit der Ansicht `kiosk` anlegt
- **THEN** antwortet der Server mit 400

#### Scenario: Alle Ansichten wählbar

- **WHEN** die Einsatzleitung die Kopplungsmaske öffnet
- **THEN** bietet sie alle neun Ansichten an, jede mit der Stellenart, an die sie gebunden ist oder sein kann, oder ohne Stelle
- **AND** nennt sie die Stelle der Verpflegung als wahlweise, die der übrigen gebundenen Ansichten als Pflicht

#### Scenario: Gebundene Ansicht ohne Stelle

- **WHEN** die Einsatzleitung ein UHS-Tablet ohne Angabe einer UHS koppeln will
- **THEN** antwortet der Server mit 400

#### Scenario: Ungebundene Ansicht mit Stelle

- **WHEN** die Einsatzleitung einen Lagemonitor mit einer UHS koppeln will
- **THEN** antwortet der Server mit 400

#### Scenario: UHS aus fremdem Einsatz

- **WHEN** die Einsatzleitung eine UHS-Ansicht an eine UHS eines anderen Einsatzes binden will
- **THEN** antwortet der Server mit 404

#### Scenario: Unbekanntes Sachgebiet

- **WHEN** die Einsatzleitung einen Stab-Fachzugang mit dem Sachgebiet `s9` koppeln will
- **THEN** antwortet der Server mit 400
