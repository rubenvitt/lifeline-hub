# adr-nummernvergabe Specification

## Purpose
Legt fest, welche Nummer eine neue Architekturentscheidung (ADR) tragen darf und wann das geprüft
wird, damit zwei parallel offene Pull Requests nicht dieselbe ADR-Nummer auf den Ziel-Branch
bringen.

## Requirements

### Requirement: Eine neue ADR trägt eine freie Nummer
Eine ADR-Datei, die ein Branch gegenüber seiner Abzweigung vom Ziel-Branch neu mitbringt, MUST
eine Nummer tragen, die auf dem aktuellen Stand des Ziel-Branches keine andere ADR-Datei trägt.
Die neuen ADRs eines Branches MUST untereinander verschiedene Nummern tragen. Eine Nummer unter
der höchsten vergebenen ist erlaubt, solange sie frei ist.

#### Scenario: Freie Nummer
- **WHEN** der Ziel-Branch ADR-0001 bis ADR-0024 trägt und der Branch `ADR-0025-x.md` neu mitbringt
- **THEN** besteht die Prüfung

#### Scenario: Kollision mit einem inzwischen gemergten Branch
- **WHEN** ein Branch `ADR-0025-a.md` mitbringt und auf dem Ziel-Branch inzwischen `ADR-0025-b.md` gemergt wurde
- **THEN** schlägt die Prüfung fehl, nennt `ADR-0025-a.md` und die nächste freie Nummer

#### Scenario: Lücke gefüllt
- **WHEN** der Ziel-Branch ADR-0024 trägt, ADR-0022 dort frei ist und der Branch `ADR-0022-x.md` mitbringt
- **THEN** besteht die Prüfung

#### Scenario: Branch ohne neue ADR
- **WHEN** ein Branch keine ADR-Datei hinzufügt
- **THEN** besteht die Prüfung

### Requirement: Die Prüfung läuft gegen den aktuellen Ziel-Branch
Die Regel MUST für jeden offenen Pull Request gegen `alpha`, `beta` oder `main` als Commit-Status
`ADR-Nummern` auf dem Kopf-Commit des PRs berichtet werden. Die Prüfung MUST neu laufen, wenn der
PR geöffnet oder aktualisiert wird und wenn sich der Ziel-Branch bewegt. Fehlt der Status auf
`alpha` unter den Required Checks, MUST der Lauf nach einem Push auf den Ziel-Branch das sichtbar
melden. Eine Kollision wird nicht automatisch behoben.

#### Scenario: Zwei parallel grüne PRs
- **WHEN** PR A und PR B beide `ADR-0025-*.md` mitbringen, beide grün sind und A gemergt wird
- **THEN** trägt der Kopf-Commit von B danach den Status `ADR-Nummern` = failure

#### Scenario: Pflicht-Eintrag fehlt
- **WHEN** auf `alpha` gepusht wird und das Ruleset `ADR-Nummern` nicht unter den Required Checks führt
- **THEN** trägt der Lauf eine Warnung, dass rote PRs trotzdem mergebar sind
