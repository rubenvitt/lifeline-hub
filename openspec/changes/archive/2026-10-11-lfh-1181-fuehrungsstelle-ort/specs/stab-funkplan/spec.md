# Spec Delta

## ADDED Requirements

### Requirement: Bezeichnung der Führungsstelle im Funkplan
Trägt die erfasste Führungsstelle eine Bezeichnung, SHALL die Zeile „Führungsstelle“ sie als
Zusatz der Stelle zeigen, am Bildschirm wie im Druck. Ohne Bezeichnung MUST die Zeile ohne Zusatz
stehen, und es MUST NOT eine Bezeichnung aus Fahrzeugen, Rufname oder Standort abgeleitet werden.

#### Scenario: Führungsstelle mit Bezeichnung
- **WHEN** die Führungsstelle mit Bezeichnung „ELW 2 Musterstadt“ und Rufname „Florian Musterstadt 10/1“ erfasst ist
- **THEN** zeigt die erste Zeile die Stelle „Führungsstelle“ mit dem Zusatz „ELW 2 Musterstadt“ und den Rufnamen

#### Scenario: Führungsstelle ohne Bezeichnung
- **WHEN** die Führungsstelle nur mit Rufname und dem ELW 2 als Führungsfahrzeug erfasst ist
- **THEN** zeigt die Zeile „Führungsstelle“ keinen Zusatz
