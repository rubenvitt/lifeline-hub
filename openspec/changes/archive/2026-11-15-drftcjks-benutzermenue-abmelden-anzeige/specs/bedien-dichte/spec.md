## MODIFIED Requirements

### Requirement: Handschuh nur auf ausdrückliche Wahl

Die Stufe `handschuh` SHALL nur durch eine ausdrückliche Wahl entstehen: über die Leiste
„Bediendichte“ im Benutzermenü, im Reiter „Anzeige“ der Einsatz-Einstellungen, im Profil oder
über die Sprungpalette. Keine Ableitung MUST `handschuh` vorbelegen.

#### Scenario: Touchgerät startet nicht im Handschuh-Modus
- **WHEN** ein Gerät mit grobem primärem Zeiger die Anwendung ohne gespeicherte Wahl öffnet
- **THEN** steht die Dichtestufe nicht auf `handschuh`

#### Scenario: Gewählter Handschuh-Modus bleibt
- **WHEN** die Stufe `handschuh` gewählt und die Anwendung neu geladen wird
- **THEN** steht die Dichtestufe auf `handschuh`

#### Scenario: Handschuh aus den Einsatz-Einstellungen
- **WHEN** im Reiter „Anzeige“ der Einsatz-Einstellungen „Handschuh“ gewählt und die Anwendung neu geladen wird
- **THEN** steht die Dichtestufe auf `handschuh`
