# Spec Delta

## REMOVED Requirements

### Requirement: Bewusst nicht live in der Organisation
**Reason**: Das Modul Stab samt Presse und Medienarbeit (S5) entfällt (LLH-722, Entscheidung 08.11.2026; design.md D1). Stab-Besetzungen gibt es nicht mehr, `meine_sachgebiete` und `meine_funktion` kommen aus der Mitgliedschaft (design.md D2); das Szenario „Stab-Besetzung“ hat keinen Gegenstand, und OpenSpec erlaubt nicht, es in einem MODIFIED-Block wegzulassen oder umzubenennen.
**Migration**: Die übrigen Ausnahmen gelten unverändert unter „Fristablauf, Lagekennzahlen, Einstellungen und Verwaltung sind in der Organisation nicht live“.

## ADDED Requirements

### Requirement: Fristablauf, Lagekennzahlen, Einstellungen und Verwaltung sind in der Organisation nicht live

Folgende Änderungen SHALL kein Org-Ereignis auslösen und werden erst beim nächsten Abruf sichtbar:
der zeitgesteuerte Ablauf der Nachlauffrist oder der Aufbewahrungsfrist, die Lagekennzahlen,
Org-Einstellungen und Org-Modul-Einstellungen, die Benutzerverwaltung und die instanzweite
Kartenkonfiguration.

#### Scenario: Org-Modul-Einstellung
- **WHEN** ein System-Admin die Sichtbarkeits-Vorgabe eines Moduls ändert
- **THEN** wird kein Ereignis `einsatzliste` verteilt
