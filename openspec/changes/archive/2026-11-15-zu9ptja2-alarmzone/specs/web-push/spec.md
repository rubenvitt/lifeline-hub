# Spec Delta

## MODIFIED Requirements

### Requirement: Meldung des Service Workers

Der Service Worker SHALL zu jedem Push eine OS-Meldung zeigen, deren Text er beim Server des
Empfängers holt. Ist der Server nicht erreichbar, MUST er eine Meldung mit dem Titel der Stufe
zeigen. Hat die App einen fokussierten Tab, MUST er die Meldung sofort wieder schließen. Ein
verdeckter Tab und ein Push zur selben Benachrichtigung MUST NOT zwei OS-Meldungen ergeben.

#### Scenario: Server vom Handy nicht erreichbar
- **WHEN** ein Push eintrifft und die Abfrage des Textes scheitert
- **THEN** erscheint die OS-Meldung „Alarm“ bzw. „Neue Benachrichtigung“, und ein Tipp öffnet den Einsatz

#### Scenario: App im Vordergrund
- **WHEN** ein Push eintrifft, während ein Tab der App fokussiert ist
- **THEN** bleibt keine OS-Meldung stehen, und der Tab zeigt den Eintrag in der Alarmzone
