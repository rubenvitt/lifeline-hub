# Spec Delta

## ADDED Requirements

### Requirement: Symbolkachel eines farblosen freien Zeichens bleibt lesbar

Trägt ein freies taktisches Zeichen keine eigene Farbe, MUST die Symbolkachel im Inspector der
Lagekarte Rahmen und Kürzel in einer Textrolle des aktiven Modus zeigen, nicht in der
DV-102-Tinte der Karte. Mit eigener Farbe zeigt die Kachel diese Farbe. Auf der Karte bleibt ein
farbloses freies Zeichen in der DV-102-Tinte.

#### Scenario: Farbloses Zeichen im Nachtmodus
- **WHEN** im Nachtmodus ein freies Zeichen ohne eigene Farbe gewählt wird
- **THEN** zeigt die Symbolkachel Rahmen und Kürzel in der Textrolle des Nachtmodus, nicht in `#333333`

#### Scenario: Zeichen mit eigener Farbe
- **WHEN** ein freies Zeichen mit der Farbe `#cc0000` gewählt wird
- **THEN** zeigt die Symbolkachel Rahmen und Kürzel in `#cc0000`

#### Scenario: Karte unverändert
- **WHEN** ein freies Zeichen ohne eigene Farbe auf der Karte gezeichnet wird
- **THEN** trägt es die DV-102-Tinte wie bisher, und das Farbfeld im Inspector schlägt dieselbe Tinte vor
