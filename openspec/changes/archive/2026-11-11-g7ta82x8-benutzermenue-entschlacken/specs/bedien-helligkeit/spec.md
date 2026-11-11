# Spec Delta

## MODIFIED Requirements

### Requirement: Helligkeitsstufen

Das System SHALL genau einen Helligkeitsregler mit den Stufen 100, 80, 60, 40 und 20 %
anbieten. Eine Stufe „aus“ (0 %) MUST NOT wählbar sein. Einen getrennten Kontrastregler
MUST es nicht geben.

#### Scenario: Stufen im Benutzermenü
- **WHEN** das Benutzermenü geöffnet wird
- **THEN** enthält die Leiste „Helligkeit“ der Gruppe „Anzeige“ genau die Stufen 100, 80, 60, 40 und 20 %
- **AND** die gewählte Stufe ist ausgewählt, sichtbar und für Hilfstechnik

#### Scenario: Stufen in der Sprungpalette
- **WHEN** in der Sprungpalette „Helligkeit“ gesucht wird
- **THEN** erscheinen fünf Schnelleinstellungen „Helligkeit: N %“, die die Wahl setzen

### Requirement: Warnsperre

Solange eine Warnung aktiv ist, SHALL die wirksame Stufe `max(Wahl, Boden)` sein. Der Boden
MUST die kleinste Stufe sein, bei der `alarmText` auf `grund` in beiden Paletten einen
Kontrast von mindestens 4,5 : 1 hält. Ohne aktive Warnung MUST die wirksame Stufe gleich der
Wahl sein. Die Sperre MUST NOT die gespeicherte Wahl ändern.

#### Scenario: Sperre greift
- **WHEN** die Wahl 40 % ist und eine Warnung aktiv wird
- **THEN** ist die wirksame Stufe der Boden (80 %)
- **AND** die gespeicherte Wahl bleibt 40 %

#### Scenario: Sperre greift nicht ohne Warnung
- **WHEN** die Wahl 40 % ist und keine Warnung aktiv ist
- **THEN** ist die wirksame Stufe 40 %

#### Scenario: Wahl über dem Boden
- **WHEN** die Wahl 100 % ist und eine Warnung aktiv ist
- **THEN** ist die wirksame Stufe 100 %

#### Scenario: Warnung endet
- **WHEN** die Warnung endet
- **THEN** gilt wieder die gewählte Stufe, ohne Nutzereingriff

#### Scenario: Erklärung im Menü
- **WHEN** eine Warnung aktiv ist und das Benutzermenü geöffnet wird
- **THEN** nennt die Leiste „Helligkeit“ den Boden und den Grund
- **AND** die Stufen unter dem Boden sind gesperrt und nennen den Grund der Sperre
- **AND** liegt die Wahl unter dem Boden, nennt die Leiste die wirksame Stufe
