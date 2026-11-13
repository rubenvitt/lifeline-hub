# Spec Delta

## MODIFIED Requirements

### Requirement: Hilfeleistungen in der Reihe „Sanitätsdienst“

Trägt der Einsatz die Wahl `sanitaetsdienst` (LLH-1574), SHALL die Verdichtung des Lagemonitors
einen Block `sanitaetsdienst` mit `kontakte`, `kontakte_letzte_stunde`, `in_versorgung` und
`transporte` liefern, nach denselben Regeln wie die Kennzahlen des Lagebilds; ohne die Wahl MUST
der Block fehlen. Die Schnittstelle für Fremdsysteme (`GET /api/v1/lage`, Spec
`lage-schnittstelle`) MUST denselben Block als optionales Feld tragen. Der Monitor MUST dann statt
„Betroffene“ die Kachel „Hilfeleistungen“ zeigen: Kontakte, letzte Stunde und vermisst, darunter
in Versorgung, Transporte und SK I. Der Block MUST nur Zahlen tragen.

#### Scenario: Reihe gewählt
- **WHEN** der Einsatz `sanitaetsdienst` trägt und 41 Kontakte zählt
- **THEN** zeigt der Monitor die Kachel „Hilfeleistungen“ mit „41 Kontakte“

#### Scenario: Reihe nicht gewählt
- **WHEN** der Einsatz `sanitaetsdienst` nicht trägt
- **THEN** fehlt `sanitaetsdienst` in der Antwort, und der Monitor zeigt „Betroffene“
