## ADDED Requirements

### Requirement: PAT-Nummer findet die Person

Die Sprungpalette SHALL eine Person auch über ihre PAT-Nummer finden. Bei einer reinen
Zifferneingabe MUST sie neben der Registriernummer auch eine genau passende PAT-Nummer als Treffer
nennen. Beide MUST unterscheidbar sein, die PAT-Nummer etwa mit dem Vorsatz „PAT“. Ohne Netz MUST
die Palette keine PAT-Nummer finden, weil sie nicht auf dem Gerät liegt.

#### Scenario: Ziffern treffen Registrier- und PAT-Nummer
- **WHEN** R-4711 existiert, R-012 die PAT-Nummer „4711“ trägt und jemand „4711“ eingibt
- **THEN** zeigt die Palette R-4711 und R-012 mit dem Hinweis „PAT 4711“

#### Scenario: Ohne Netz
- **WHEN** die Palette ohne Netz nach einer PAT-Nummer gefragt wird
- **THEN** findet sie die Person nicht über die PAT-Nummer
