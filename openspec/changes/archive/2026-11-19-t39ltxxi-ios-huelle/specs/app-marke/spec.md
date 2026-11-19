# Spec Delta

## ADDED Requirements

### Requirement: iOS-Symbol aus der Bildmarke

Die iOS-App SHALL ihr Symbol aus derselben Bildmarke beziehen wie Browser, PWA und Desktop-App,
auf Kopf-Schwarz und ohne Transparenz, in der Größe, die iOS verlangt (1024 × 1024 Pixel). Pulslinie
und Quadrat MUST auch in der kleinsten Darstellung auf dem Home-Bildschirm unterscheidbar bleiben.

#### Scenario: Home-Bildschirm

- **WHEN** die iOS-App auf einem iPhone installiert ist
- **THEN** zeigt der Home-Bildschirm die Bildmarke auf Kopf-Schwarz

#### Scenario: Kleinste Darstellung

- **WHEN** das Symbol in der Einstellungen-Liste von iOS erscheint
- **THEN** sind Zacke der Pulslinie und rotes Quadrat als getrennte Formen erkennbar
