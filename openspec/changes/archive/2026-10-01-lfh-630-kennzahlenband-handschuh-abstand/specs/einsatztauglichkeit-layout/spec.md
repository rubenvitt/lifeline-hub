## ADDED Requirements

### Requirement: Abstand zwischen klickbaren Kennzahlen

Zwei benachbarte klickbare Kennzahlen eines Kennzahlenbands SHALL in der Dichtestufe
`komfortabel` mindestens 8 px und in `handschuh` mindestens 16 px Abstand zwischen ihren
Treffflächen halten, gemessen auf beiden Achsen. Das Band MUST dabei sein Fugenraster
behalten: die sichtbare Linie zwischen zwei Zellen bleibt in jeder Stufe 1 px breit. Jede
Trefffläche MUST weiterhin die Steuerhöhe der Stufe erreichen (30 / 48 / 72 px).

#### Scenario: Handschuh-Betrieb auf dem Lage-Dashboard
- **WHEN** die Dichtestufe `handschuh` gewählt ist und das Band „Lage in Zahlen“ mit seinen sechs klickbaren Kennzahlen am Fükw-Schirm steht
- **THEN** liegt zwischen jeder Kennzahl und ihrem nächsten anderen Bedienziel im Band ein Abstand von mindestens 16 px, und jede Kennzahl ist mindestens 72 px hoch

#### Scenario: Touch-Betrieb
- **WHEN** dieselbe Seite in der Stufe `komfortabel` steht
- **THEN** beträgt der kleinste Abstand zwischen zwei Kennzahlen mindestens 8 px

#### Scenario: Die Fuge bleibt eine Fuge
- **WHEN** das Band in `handschuh` steht
- **THEN** ist der Spalt zwischen zwei benachbarten Zellflächen weiterhin 1 px breit, und zwischen Zellrand und Trefffläche liegt Zellfläche, keine Linienfarbe

#### Scenario: Kompakt bleibt unverändert
- **WHEN** das Band in `kompakt` steht
- **THEN** füllt die Trefffläche jeder klickbaren Kennzahl ihre Zelle vollständig aus
