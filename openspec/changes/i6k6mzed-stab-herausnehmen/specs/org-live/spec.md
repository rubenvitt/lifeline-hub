# Spec Delta

## MODIFIED Requirements

### Requirement: Bewusst nicht live in der Organisation
Folgende Änderungen SHALL kein Org-Ereignis auslösen und werden erst beim nächsten Abruf sichtbar:
der zeitgesteuerte Ablauf der Nachlauffrist oder der Aufbewahrungsfrist, die Lagekennzahlen,
Org-Einstellungen und Org-Modul-Einstellungen, die Benutzerverwaltung und die instanzweite
Kartenkonfiguration.

#### Scenario: Org-Modul-Einstellung
- **WHEN** ein System-Admin die Sichtbarkeits-Vorgabe eines Moduls ändert
- **THEN** wird kein Ereignis `einsatzliste` verteilt
