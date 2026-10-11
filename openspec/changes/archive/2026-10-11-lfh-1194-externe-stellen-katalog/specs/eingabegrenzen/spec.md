# Spec Delta

## ADDED Requirements

### Requirement: Meldende Stelle ist begrenzt
Die meldende Stelle eines Einsatzes MUST beim Ändern des Einsatzes nach dem Trimmen höchstens
200 Zeichen lang sein, sonst 400 ohne Änderung am Einsatz. Ein schon gespeicherter längerer Wert
MUST stehen bleiben, bis jemand ihn ändert. Die Eingabe der Seite Einsatzdaten MUST dieselbe
Grenze einhalten.

#### Scenario: Ein Zeichen zu viel
- **WHEN** ein Einsatz mit einer meldenden Stelle von 201 Zeichen geändert wird
- **THEN** antwortet der Server mit 400, die Meldung nennt „Meldende Stelle“ und 200, und der Einsatz bleibt unverändert

#### Scenario: Genau an der Grenze
- **WHEN** ein Einsatz mit einer meldenden Stelle von genau 200 Zeichen geändert wird
- **THEN** speichert der Server den Wert

#### Scenario: Andere Angabe eines Einsatzes mit Altwert
- **WHEN** ein Einsatz eine gespeicherte meldende Stelle von 300 Zeichen hat und nur die Leitstellen-Nr. geändert wird
- **THEN** speichert der Server die Leitstellen-Nr., und die meldende Stelle bleibt unverändert
