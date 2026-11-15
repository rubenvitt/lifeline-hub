# Spec Delta

## ADDED Requirements

### Requirement: Abschnitt im Überblick nennt Rückmeldung und Ausfall wie das Meldebild
Die Abschnittskarte im Überblick SHALL die Rückmeldung jeder Einheit ihres Teilbaums mit derselben
Regel beurteilen wie das Meldebild und überfällige oder fehlende Rückmeldungen als Etikett in der
Alarmrolle nennen, die überfällige mit Dauer. Ihr Ausfall MUST aus derselben Zählung kommen wie im
Meldebild (Mittel und Material der Einheiten). Ein gepflegter Lagezustand MUST unverändert
stehen bleiben; das Etikett steht daneben.

#### Scenario: Eine Einheit schweigt
- **WHEN** im Abschnitt Logistik die Rückmeldung des Logistiktrupps seit 47 Minuten fällig ist und eine andere Einheit vor 5 Minuten zurückgemeldet hat
- **THEN** zeigt die Abschnittskarte „Rückm. überfällig seit 47 min“ in der Alarmrolle

#### Scenario: Mehrere Einheiten überfällig
- **WHEN** im Teilbaum drei Einheiten überfällig sind, die längste seit 47 Minuten
- **THEN** zeigt die Abschnittskarte „3 Einh. Rückm. überfällig, längste seit 47 min“

#### Scenario: Ausfall wie im Meldebild
- **WHEN** das Meldebild für eine Einheit im Abschnitt „1 Ausfall“ und „1 Ausfall Material“ zeigt
- **THEN** zeigt die Abschnittskarte „1 Ausfall“ und „1 Ausfall Material“ in der Alarmrolle, und die Statusverteilung nennt ihre dritte Zelle „nicht verfügbar“

#### Scenario: Planmäßig mit überfälliger Rückmeldung
- **WHEN** der Abschnitt den Lagezustand „planmäßig“ trägt und eine Rückmeldung darin überfällig ist
- **THEN** bleiben Kante und Etikett „planmäßig“ unverändert, und direkt daneben steht das Alarm-Etikett zur Rückmeldung

#### Scenario: Rückmeldungen nicht abrufbar
- **WHEN** die Rückmeldungen nicht geladen oder nicht abrufbar sind
- **THEN** zeigt die Abschnittskarte kein Rückmeldungs-Etikett, statt jede Einheit als schweigend zu melden
