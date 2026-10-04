# Spec Delta

## ADDED Requirements

### Requirement: Der Zustand eines Pegels folgt dem Statusfarb-Vertrag
Wählt ein Benutzer einen PEGELONLINE-Pegel an, SHALL der Inspector dessen Zustand gegenüber
mittlerem Niedrig- und Hochwasser mit einem Wort und einer Rolle aus dem Statusfarb-Vertrag
zeigen: „Hoch“ und „Niedrig“ in der Rolle `achtung`, „Normal“ in der Rolle `normal`. Kein
Zustand MUST in der Alarm- oder der Bedienfarbe erscheinen. Ein anderer oder fehlender Zustand
MUST ohne Kennzeichnung bleiben, statt einen Rohwert oder eine erfundene Stufe zu zeigen.

#### Scenario: Pegel über dem mittleren Hochwasser
- **WHEN** ein Benutzer einen Pegel mit Zustand `high` anwählt
- **THEN** zeigt der Inspector neben dem Wasserstand „Hoch“ in der Achtung-Rolle und nichts davon in Rot oder Blau

#### Scenario: Pegel im Normalbereich
- **WHEN** ein Benutzer einen Pegel mit Zustand `normal` anwählt
- **THEN** zeigt der Inspector „Normal“ in der Normal-Rolle

#### Scenario: Pegel unter dem mittleren Niedrigwasser
- **WHEN** ein Benutzer einen Pegel mit Zustand `low` anwählt
- **THEN** zeigt der Inspector „Niedrig“ in der Achtung-Rolle

#### Scenario: Zustand ohne Aussage
- **WHEN** ein Benutzer einen Pegel mit Zustand `unknown`, `commented`, `out-dated` oder ohne Zustand anwählt
- **THEN** zeigt der Inspector den Wasserstand ohne Zustandskennzeichnung und nicht den Rohwert
