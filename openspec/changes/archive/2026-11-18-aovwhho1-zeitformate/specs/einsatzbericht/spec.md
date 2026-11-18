## MODIFIED Requirements

### Requirement: Anlage Einheiten mit Einsatzzeiten

Die optionale Anlage Einheiten mit Einsatzzeiten SHALL je Einheit mit Zeitachse den Namen,
den Beginn der ersten Periode, das Ende der letzten Periode und die Einsatzzeit als Summe
ihrer Perioden nennen. Eine offene Periode MUST im laufenden Einsatz als Ende „läuft“ stehen
und bis zum Stand zählen; nach dem Abschluss MUST sie als Ende „nicht erfasst“ stehen und bis
zum Abschluss zählen. Einheiten ohne Zeitachse MUST NOT mit einer Einsatzzeit von 0 erscheinen.

#### Scenario: Einheit noch im Einsatz

- **WHEN** eine Einheit seit 11.10.2026 08:00 Uhr im laufenden Einsatz ist und der Bericht um 14:32 Uhr gedruckt wird
- **THEN** steht sie mit Beginn `110800okt26`, Ende „läuft“ und Einsatzzeit 6 h 32 min

#### Scenario: Offene Periode nach dem Abschluss

- **WHEN** eine Einheit seit 08:00 im Einsatz steht, ohne entlassen zu sein, und der Einsatz um
  12:00 abgeschlossen wurde
- **THEN** steht sie mit Ende „nicht erfasst“ und Einsatzzeit 4 h

#### Scenario: Einheit ohne Zeitachse

- **WHEN** eine Einheit im Einsatz geführt ist, aber kein Zeitachsen-Ereignis hat
- **THEN** nennt die Anlage, für wie viele Einheiten keine Zeitachse erfasst ist
- **AND** die Einheit steht nicht mit einer Einsatzzeit von 0 in der Tabelle

