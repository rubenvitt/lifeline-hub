# befehlsvorlagen Specification

## Purpose
Legt fest, welche Befehlsvorlagen ein neuer Befehlsentwurf anbietet und wie Befehle mit einer
Vorlage, die nicht mehr angeboten wird, weiter gelesen, bearbeitet und gedruckt werden.

## Requirements

### Requirement: Der Einzelauftrag ist keine Befehlsvorlage für neue Befehle
Der Dialog „Neuer Befehlsentwurf“ SHALL die Vorlagen „Befehl LAD (vereinfacht)“, „Befehl
LADEF (erweitert, SKK)“ und „Befehl SCHNEE“ anbieten. Die Vorlage „Einzelauftrag (EA/ZMW)“ MUST NOT
angeboten werden: ein Einzelauftrag braucht Empfänger, Quittung und Vollzug, und das trägt nur
der Auftrag.

#### Scenario: Auswahl im Dialog
- **WHEN** jemand im Reiter „Befehle“ einen neuen Befehlsentwurf öffnet und das Schema aufklappt
- **THEN** stehen genau die drei Befehlsvorlagen zur Wahl, „Einzelauftrag (EA/ZMW)“ fehlt

### Requirement: Ein Befehl mit einer nicht mehr angebotenen Vorlage bleibt bedienbar
Ein Befehl, der mit der Vorlage „Einzelauftrag (EA/ZMW)“ angelegt wurde, SHALL sich weiter in
seinen Abschnitten öffnen, im Entwurf bearbeiten und speichern, freigeben, fortschreiben und
drucken lassen, unverändert gegenüber dem Stand vor dieser Änderung. Die Befehlsliste SHALL ihn
weiter mit dem Namen seiner Vorlage zeigen und nach ihr filtern lassen. Der Server MUST einen
solchen Befehl weiter annehmen.

#### Scenario: Bestehender Einzelauftrag-Befehl
- **WHEN** jemand einen bestehenden Befehlsentwurf mit der Vorlage „Einzelauftrag (EA/ZMW)“ öffnet
- **THEN** stehen die Abschnitte „Einheit“, „Auftrag / Ziel“, „Mittel“ und „Weg“ mit ihrem Text
- **AND** „Speichern“ sendet sie unter ihren Schlüsseln

#### Scenario: Fortschreiben
- **WHEN** ein freigegebener Befehl mit der Vorlage „Einzelauftrag (EA/ZMW)“ fortgeschrieben wird
- **THEN** trägt die neue Fassung dieselbe Vorlage und dieselben Abschnitte

#### Scenario: Filter der Befehlsliste
- **WHEN** jemand die Befehlsliste nach dem Schema „Einzelauftrag (EA/ZMW)“ filtert
- **THEN** stehen genau die Befehle mit dieser Vorlage in der Liste
