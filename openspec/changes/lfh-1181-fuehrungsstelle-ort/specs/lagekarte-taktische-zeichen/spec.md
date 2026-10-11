# Spec Delta

## ADDED Requirements

### Requirement: Führungsstelle auf der Lagekarte
Trägt die eigene Führungsstelle eine Koordinate, SHALL die Lagekarte sie als Marker mit dem
DV-102-Zeichen „Befehlsstelle“ zeigen, beschriftet mit ihrer Bezeichnung, ohne Bezeichnung mit
„Führungsstelle“. Der Marker MUST nur lesend sein (nicht verschiebbar, nicht platzierbar) und auf
ihr Paneel in den Einsatzdaten verweisen. Ohne Koordinate MUST er fehlen.

#### Scenario: Führungsstelle mit Koordinate
- **WHEN** die Führungsstelle „ELW 2 Musterstadt“ mit Koordinate erfasst ist
- **THEN** zeigt die Lagekarte dort das Zeichen „Befehlsstelle“ mit der Beschriftung „ELW 2 Musterstadt“

#### Scenario: Ohne Koordinate
- **WHEN** die Führungsstelle nur eine Adresse trägt
- **THEN** zeigt die Lagekarte keinen Marker der Führungsstelle

#### Scenario: Marker lässt sich nicht verschieben
- **WHEN** eine Person mit Schreibrecht den Marker der Führungsstelle ziehen will
- **THEN** bleibt er an seiner Koordinate, und der Inspector verweist auf die Einsatzdaten
