# Spec Delta

## MODIFIED Requirements

### Requirement: Gefahren je Gebiet in der Gefahren-/Schadenlage
Die Übernahme der Gefahren-/Schadenlage SHALL einen Teil „Gefahrengebiete“ enthalten: je Gebiet
den Namen, bei einem unbestätigten „(unbestätigt)“, und darunter jede gesetzte Gefahr (Stufe
über „keine“ oder mit Erläuterung) mit Stufe und Erläuterung in der Folge der Matrix. Die
Erläuterung und der Gebietsname sind Beurteilung der eigenen Führung, kein Freitext Dritter, und
SHALL übernommen werden; „gemeldet von“ und der Name der letzten Änderung MUST draußen bleiben.

#### Scenario: Gefahren je Gebiet
- **WHEN** das Gebiet „Überflutung Unterstadt“ Elektrizität × Menschen auf „hoch“ mit der Erläuterung „Stromführende Kellerverteilungen unter Wasser“ trägt
- **THEN** nennt der Teil „Gefahrengebiete“ das Gebiet und darunter „Elektrizität × Menschen: hoch · Stromführende Kellerverteilungen unter Wasser“

#### Scenario: Meldeweg einer Gefahr bleibt draußen
- **WHEN** eine Gefahrenbewertung die Erläuterung „Keller unter Wasser“ und „gemeldet von Herr Schmidt“ trägt
- **THEN** enthält die Gefahren-/Schadenlage „Keller unter Wasser“, aber nicht „Herr Schmidt“

#### Scenario: Gefahren gesperrt
- **WHEN** das Modul Gefahren für die Person gesperrt ist und sie die Gefahren-/Schadenlage übernimmt
- **THEN** steht der Teil „Gefahrengebiete“ als „— (nicht freigegeben)“, und weder Gebiete noch Matrizen wurden angefragt

#### Scenario: Unbestätigtes Gebiet
- **WHEN** das Gebiet „Zone B“ noch niemand bestätigt hat
- **THEN** nennt der Teil „Gefahrengebiete“ es als „Zone B (unbestätigt)“, nie „nicht beurteilt“
