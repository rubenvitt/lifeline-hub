# Spec Delta

## MODIFIED Requirements

### Requirement: Schicht einer Einheit

Das System SHALL je Einheit eines Einsatzes Schichten führen. Eine Schicht trägt Beginn
(Einsatzbeginn der Einheit), Rhythmus in Minuten, die daraus berechnete Fälligkeit
(Beginn + Rhythmus), optional eine geplante ablösende Einheit und einen Status
(`laufend` oder `abgeloest`). Je Einheit MUST höchstens eine Schicht `laufend` sein. Fehlt beim
Anlegen der Beginn, MUST das System das nicht gestrichene Eintreffen der offenen Einsatzperiode
der Einheit aus der Kräfte-Zeitachse übernehmen und ohne ein solches den Zeitpunkt der Anlage.

#### Scenario: Schicht beginnen mit eigenem Rhythmus
- **WHEN** eine Person mit Schreibrecht für Einheit „Florian 1“ eine Schicht mit Beginn 09:30 und Rhythmus 360 min anlegt
- **THEN** entsteht eine laufende Schicht mit Fälligkeit 15:30

#### Scenario: Beginn fehlt, Einheit ist eingetroffen
- **WHEN** um 09:00 eine Schicht ohne Beginn für eine Einheit angelegt wird, deren offene Periode ein Eintreffen um 06:40 trägt
- **THEN** beginnt die Schicht um 06:40

#### Scenario: Beginn fehlt
- **WHEN** eine Schicht ohne Beginn für eine Einheit ohne Eintreffen in einer offenen Periode angelegt wird
- **THEN** gilt der Zeitpunkt der Anlage als Beginn

#### Scenario: Zweite laufende Schicht
- **WHEN** für eine Einheit mit laufender Schicht eine weitere angelegt wird
- **THEN** antwortet das System mit 422 und legt nichts an

#### Scenario: Einheit eines anderen Einsatzes
- **WHEN** die angegebene Einheit nicht zum Einsatz gehört
- **THEN** antwortet das System mit 404

#### Scenario: Ungültiger Rhythmus
- **WHEN** der Rhythmus fehlt und der Abschnitt der Einheit keine Vorgabe hat, oder der Rhythmus ≤ 0 oder > 7 Tage ist
- **THEN** antwortet das System mit 400
