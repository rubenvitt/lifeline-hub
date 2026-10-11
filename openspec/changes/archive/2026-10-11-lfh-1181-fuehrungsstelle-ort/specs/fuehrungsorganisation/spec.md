# Spec Delta

## ADDED Requirements

### Requirement: Führungsstelle an der Wurzel
Ist die eigene Führungsstelle erfasst, SHALL die Wurzel „Einsatzleitung“ ihre Bezeichnung und ihren
Rufnamen zeigen, soweit gesetzt, am Bildschirm, im Druck und in der Übernahme in den Lagebericht
gleich. „Leitung nicht erfasst“ MUST bleiben, denn die Führungsstelle nennt keine Person. Ist sie
nicht erfasst oder ihr Abruf gescheitert, MUST die Wurzel aussehen wie ohne diese Anforderung.

#### Scenario: Wurzel mit Führungsstelle
- **WHEN** die Führungsstelle „ELW 2 Musterstadt“ mit Rufname „Florian Musterstadt 10/1“ erfasst ist
- **THEN** zeigt die Wurzel „Einsatzleitung“, „ELW 2 Musterstadt“, „Florian Musterstadt 10/1“ und „Leitung nicht erfasst“

#### Scenario: Führungsstelle ohne Bezeichnung
- **WHEN** die Führungsstelle nur einen Rufnamen trägt
- **THEN** zeigt die Wurzel den Rufnamen und keine erfundene Bezeichnung
