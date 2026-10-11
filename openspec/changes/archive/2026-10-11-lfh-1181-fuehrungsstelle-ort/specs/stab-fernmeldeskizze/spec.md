# Spec Delta

## ADDED Requirements

### Requirement: Bezeichnung der Führungsstelle im Kasten „Einsatzleitung“
Trägt die erfasste Führungsstelle eine Bezeichnung, SHALL der Kasten „Einsatzleitung“ sie als
eigene Zeile zwischen Überschrift und Rufname zeigen, auf dem Bildschirm, im Auto-Layout und im
Druck gleich; ein langer Text MUST umbrechen und MUST NOT gekürzt werden. Die Überschrift bleibt
„Einsatzleitung“. Ohne Bezeichnung MUST der Kasten so hoch bleiben wie ohne diese Anforderung.

#### Scenario: Kasten mit Bezeichnung
- **WHEN** die Führungsstelle mit Bezeichnung „TEL Rathaus“ und Rufname „Florian Musterstadt 10/1“ erfasst ist
- **THEN** zeigt der Kasten „Einsatzleitung“, darunter „TEL Rathaus“ und darunter den Rufnamen

#### Scenario: Nicht erfasste Führungsstelle
- **WHEN** die Führungsstelle nicht erfasst ist
- **THEN** steht weiter „Einsatzleitung: Gegenstelle nicht erfasst“ ohne Bezeichnungszeile
