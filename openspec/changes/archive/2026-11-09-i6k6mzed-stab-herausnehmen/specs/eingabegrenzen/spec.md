# Spec Delta

## REMOVED Requirements

### Requirement: Freitexte in Infotelefon, Presse und Schaden sind begrenzt
**Reason**: Das Modul Stab samt Presse und Medienarbeit (S5) entfällt (LLH-722, Entscheidung 08.11.2026; design.md D1). Die Medienkontakte des Presse-Logs entfallen.
**Migration**: Die Grenzen für Anruferfassung und Schäden gelten unverändert weiter im neuen Requirement „Freitexte in Infotelefon und Schaden sind begrenzt“.

## ADDED Requirements

### Requirement: Freitexte in Infotelefon und Schaden sind begrenzt
Die Freitexte der Anruferfassung und der Schäden (Anlegen, Ändern) MUST die Grenzen der Tabelle
in `design.md` (D6) einhalten, sonst 400. Die bestehende 422 für eine fehlende Rückrufnummer MUST
bleiben.

#### Scenario: Zu lange Schadensbeschreibung beim Ändern
- **WHEN** ein Schaden mit einer Beschreibung von 8 001 Zeichen geändert wird
- **THEN** antwortet der Server mit 400, und der Schaden bleibt unverändert

#### Scenario: Rückruf ohne Nummer bleibt 422
- **WHEN** ein Anruf mit „Rückruf nötig“ ohne Rückrufnummer und mit einer Notiz innerhalb der Grenze erfasst wird
- **THEN** antwortet der Server mit 422
