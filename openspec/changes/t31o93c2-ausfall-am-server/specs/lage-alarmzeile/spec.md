# Spec Delta

## MODIFIED Requirements

### Requirement: Quellen in der Alarmrolle
Die Alarmzeile SHALL je Art einen Eintrag in der Alarmrolle zeigen, sobald die Art mindestens
einmal vorliegt:
- offene Sofortmeldungen, ab Eingang
- Meldungen mit überfälliger Bestätigung
- Einheiten mit überfälliger Rückmeldung
- Einheiten mit Ausfall
- Vermisste
- Abschnitte mit dem Lagezustand „kritisch“
- überfällige Aufträge

Jede Zahl MUST aus derselben Heimat kommen wie an ihrer Stelle im Modul. Einheiten mit Ausfall
MUST in der Folge der Einheitenliste stehen (Sortierung, dann Anlage), „Ohne Einheit“ zuletzt.

#### Scenario: Frische Sofortmeldung
- **WHEN** vor einer Minute eine Sofortmeldung eingegangen ist und ihre Bestätigungsfrist noch läuft
- **THEN** steht „1 Sofortmeldung“ in der Alarmrolle in der Zeile, ohne auf den Ablauf der Frist zu warten

#### Scenario: Rückmeldung überfällig
- **WHEN** die Rückmeldung des Logistiktrupps seit 47 Minuten und die des Sanitätszugs seit 12 Minuten überfällig ist
- **THEN** zeigt die Zeile „Rückmeldung überfällig: Logistiktrupp, Sanitätszug · längste 47 min“ in der Alarmrolle

#### Scenario: Ausfall wie im Meldebild
- **WHEN** das Meldebild beim Logistiktrupp, und nur dort, einen Ausfall nennt
- **THEN** zeigt die Zeile „Ausfall: Logistiktrupp“ in der Alarmrolle

#### Scenario: Ausfall in der Folge der Einheitenliste
- **WHEN** die Einheitenliste Sanitätszug vor Logistiktrupp führt und beide sowie Mittel ohne Einheit einen Ausfall haben
- **THEN** zeigt die Zeile „Ausfall: Sanitätszug, Logistiktrupp +1“, und die volle Liste endet mit „Ohne Einheit“

#### Scenario: Gepflegter Lagezustand planmäßig
- **WHEN** ein Abschnitt den Lagezustand „planmäßig“ trägt und eine Rückmeldung darin überfällig ist
- **THEN** nennt die Zeile die Rückmeldung, aber keinen kritischen Abschnitt
