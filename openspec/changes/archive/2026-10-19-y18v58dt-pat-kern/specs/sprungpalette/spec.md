## ADDED Requirements

### Requirement: PAT-Nummer findet die Person

Die Sprungpalette SHALL eine Person auch über ihre PAT-Nummer finden. Bei einer reinen
Zifferneingabe MUST sie neben der Registriernummer auch eine genau passende PAT-Nummer als Treffer
nennen. Beide MUST unterscheidbar sein, die PAT-Nummer etwa mit dem Vorsatz „PAT“. Die PAT-Nummer
MUST NOT im Lagebild auf dem Gerät liegen; nach einem Start ohne Netz findet die Palette eine Person
deshalb nicht über sie. Ein Tab, der die Auswahl vor dem Netzausfall geladen hat, behält sie im
Speicher und findet die Person weiter.

#### Scenario: Ziffern treffen Registrier- und PAT-Nummer
- **WHEN** R-4711 existiert, R-012 die PAT-Nummer „4711“ trägt und jemand „4711“ eingibt
- **THEN** zeigt die Palette R-4711 und R-012 mit dem Hinweis „PAT 4711“

#### Scenario: Start ohne Netz
- **WHEN** die App ohne Netz startet und die Palette nach einer PAT-Nummer gefragt wird
- **THEN** findet sie die Person nicht über die PAT-Nummer
- **AND** über Registriernummer und Namen findet sie die Person weiter
