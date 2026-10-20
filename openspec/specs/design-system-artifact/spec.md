# design-system-artifact Specification

## Purpose
Das Design System „Lifeline Hub“ ist die Gestaltungsgrundlage für Entwürfe und Folien in Claude.
Es entsteht aus dem Code der App, damit es nie von ihr abweicht.

## Requirements

### Requirement: Das Design System wird aus dem Code erzeugt

Ein Generator im Repo SHALL den vollständigen Inhalt des Design Systems aus dem Code erzeugen:
Farbtokens für Nacht und Tag aus den Farbrollen und Paletten der App, Schriftskala und Schriften,
Abstände je Dichtestufe, Radius, eine README und Vorschauen zentraler Bausteine. Kein Wert MUST von
Hand ins Design System geschrieben werden. Der Nachtbetrieb MUST das erste Thema sein. Die README
MUST die Gestaltungsregeln aus `frontend/AGENTS.md` wiedergeben, nicht eigene Regeln formulieren.

#### Scenario: Farbrolle geändert
- **WHEN** die Farbrolle `text2` im Nachtbetrieb in `theme/tokens.ts` einen neuen Wert bekommt und der Generator läuft
- **THEN** trägt das erzeugte `tokens.json` den neuen Wert unter dem Thema Nacht, und sonst ändert sich nichts

### Requirement: Drift ist im Gate rot

Das Erzeugte SHALL versioniert im Repo liegen. Das Gate MUST rot werden, wenn das Erzeugte nicht dem
entspricht, was der Generator aus dem aktuellen Code erzeugt, und MUST den Befehl nennen, der es
neu erzeugt.

#### Scenario: Token geändert, nicht neu erzeugt
- **WHEN** ein PR eine Farbrolle ändert, ohne den Generator laufen zu lassen
- **THEN** schlägt der Wächter fehl und nennt den Befehl zum Neuerzeugen

### Requirement: Veröffentlicht auf einer festen Adresse

Das Design System SHALL als Artifact vom Typ „Design System“ auf einer festen Adresse veröffentlicht
sein, die im Repo steht. Nach einem gemergten PR, der das Erzeugte ändert, MUST es aus dem Stand von
`alpha` neu veröffentlicht werden. Eine Veröffentlichung MUST nur das Erzeugte senden und MUST NOT
Regeln oder Werte enthalten, die nicht aus dem Repo stammen.

#### Scenario: Neue Rolle nach dem Merge
- **WHEN** ein PR mit einer neuen Farbrolle in `alpha` gemergt ist
- **THEN** zeigt das veröffentlichte Design System nach der Neuveröffentlichung die neue Rolle
