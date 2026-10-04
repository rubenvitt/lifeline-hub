# Spec Delta

## ADDED Requirements

### Requirement: Vorgabefarbe einer freien Skizze

Eine freie Skizze ohne gespeicherte Farbe SHALL in genau einer Vorgabefarbe gezeichnet werden.
Dieselbe Vorgabe MUST beim Anlegen (Fläche und Linie), in der Kartendarstellung und als Wert des
Farbfelds im Zonen-Inspector gelten. Die Vorgabe ist ein gespeicherter Datenwert und MUST NOT
mit dem Hell-/Nachtmodus wechseln.

#### Scenario: Farbfeld unverändert verlassen
- **WHEN** im Zonen-Inspector einer freien Skizze ohne gespeicherte Farbe das Farbfeld fokussiert und ohne Änderung verlassen wird
- **THEN** schreibt der Inspector nichts an den Server

#### Scenario: Neue Skizze trägt die Vorgabe
- **WHEN** eine freie Skizze als Fläche oder als Linie neu angelegt wird
- **THEN** wird sie mit der Vorgabefarbe gespeichert, und die Karte zeichnet sie in derselben Farbe

#### Scenario: Moduswechsel
- **WHEN** zwischen Hell- und Nachtmodus gewechselt wird
- **THEN** behalten bestehende und neue freie Skizzen ihre Farbe
