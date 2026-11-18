# Spec Delta

## ADDED Requirements

### Requirement: Einheiten mit Ausfall in der Folge der Einheitenliste
Die Alarmzeile SHALL die Einheiten mit Ausfall auf Überblick, Lagebild und Lagemonitor in der Folge
der Einheitenliste nennen: nach der Sortierung, dann nach der Anlage, „Ohne Einheit“ zuletzt. Die
Baumfolge des Meldebilds MUST dafür nicht gelten.

#### Scenario: Ausfall in der Folge der Einheitenliste
- **WHEN** die Einheitenliste Sanitätszug vor Logistiktrupp führt und beide sowie Mittel ohne Einheit einen Ausfall haben
- **THEN** zeigt die Zeile „Ausfall: Sanitätszug, Logistiktrupp +1“, und die volle Liste endet mit „Ohne Einheit“

#### Scenario: Untereinheit vor ihrer Obereinheit
- **WHEN** die Betreuungsgruppe dem Sanitätszug unterstellt ist, in der Einheitenliste aber vor ihm steht, und beide einen Ausfall haben
- **THEN** zeigt die Zeile „Ausfall: Betreuungsgruppe, Sanitätszug“
