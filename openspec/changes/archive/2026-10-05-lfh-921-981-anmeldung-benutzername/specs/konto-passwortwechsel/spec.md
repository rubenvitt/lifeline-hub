# Spec Delta

## ADDED Requirements

### Requirement: Der Passwortwechsel hasht unter der Überlastgrenze

Der Self-Service-Passwortwechsel MUST das neue Passwort unter derselben Grenze gleichzeitiger
Passwortberechnungen hashen wie der Login und darf dabei keinen Server-Thread für Anfragen
blockieren. Ist die Grenze über die Wartefrist ausgeschöpft, MUST der Wechsel mit 503 scheitern
und das bisherige Passwort gültig lassen.

#### Scenario: Wechsel bei ausgeschöpfter Grenze

- **WHEN** alle Plätze für Passwortberechnungen über die Wartefrist belegt sind und ein Benutzer sein Passwort wechselt
- **THEN** antwortet der Server mit 503
- **AND** das bisherige Passwort bleibt gültig
