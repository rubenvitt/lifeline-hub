## MODIFIED Requirements

### Requirement: Lücken oberhalb der Tabelle
Oberhalb der Tabelle SHALL der Funkplan diese Lücken als Anzahl zeigen:
- Abschnitte ohne Sprechgruppe
- Einheiten ohne Sprechgruppe
- Einheiten ohne Erreichbarkeit
- einsatzlokale Sprechgruppen, die weder einem Abschnitt noch einer Einheit zugeordnet sind
- Verbindungen ohne gemeinsame Sprechgruppe: eine Stelle und ihre übergeordnete Stelle haben beide
  Sprechgruppen, aber keine gemeinsame

Jede Zahl MUST aus denselben geladenen Listen gerechnet werden wie die Tabelle. Hängt eine Zahl an
einer gesperrten, nicht geladenen oder noch ladenden Liste, MUST sie „—“ mit Grund zeigen und
MUST NOT „0“ zeigen. Bei einer Zahl größer null MUST der Funkplan die betroffenen Datensätze
nennen: Abschnitte und Einheiten als Verweis auf die Stelle, an der sie gepflegt werden,
einsatzlokale Sprechgruppen mit ihrer Bezeichnung, Verbindungen als Verweis auf die untere Stelle.
Die Lücken MUST im ersten Bild stehen, bei 1366 × 768 px mit offenem Modulpanel. Sie MUST in
beiden Darstellungen des Funkplans (Tabelle und Skizze) dieselben sein.

#### Scenario: Abschnitt ohne Sprechgruppe
- **WHEN** einem von drei Abschnitten keine Sprechgruppe zugeordnet ist
- **THEN** zeigt der Funkplan „1“ bei „Abschnitte ohne Sprechgruppe“

#### Scenario: Einsatzlokale Sprechgruppe ohne Zuordnung
- **WHEN** im Einsatz die lokale Sprechgruppe „DMO 999“ angelegt, aber nirgends zugeordnet ist
- **THEN** zählt sie bei „einsatzlokale Sprechgruppen ohne Zuordnung“ und wird dort mit ihrer
  Bezeichnung genannt

#### Scenario: Einheiten gesperrt
- **WHEN** die Einheitenliste mit 403 abgelehnt wird
- **THEN** zeigen „Einheiten ohne Sprechgruppe“, „Einheiten ohne Erreichbarkeit“,
  „einsatzlokale Sprechgruppen ohne Zuordnung“ und „Verbindungen ohne gemeinsame Sprechgruppe“
  „—“ mit Grund, nicht „0“

#### Scenario: Einheit ohne gemeinsamen Kanal mit ihrem Abschnitt
- **WHEN** der Abschnitt „EA Nord“ die Sprechgruppe „TMO 311“ trägt und die ihm zugeordnete
  Einheit „1. Zug“ nur „DMO 505“
- **THEN** zeigt der Funkplan „1“ bei „Verbindungen ohne gemeinsame Sprechgruppe“ und nennt
  „1. Zug“ als Verweis auf die Einheit

#### Scenario: Stelle ohne Sprechgruppe zählt nicht doppelt
- **WHEN** eine Einheit gar keine Sprechgruppe trägt
- **THEN** zählt sie bei „Einheiten ohne Sprechgruppe“, aber nicht bei „Verbindungen ohne
  gemeinsame Sprechgruppe“
