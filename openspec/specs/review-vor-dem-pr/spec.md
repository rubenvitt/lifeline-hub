# review-vor-dem-pr Specification

## Purpose
Legt fest, dass vor dem PR kein Review von selbst läuft (seit 17.11.2026) und wie ein Review
aussieht, wenn der Mensch einen verlangt.

## Requirements

### Requirement: Ein Review läuft nur auf Wunsch des Menschen
Der Main-Loop MUST NOT vor dem PR von sich aus einen Review-Agenten oder -Workflow starten. Die
Gates (`check-all.sh`) sind die Prüfung vor dem PR. Verlangt der Mensch einen Review, SHOULD ein
eigener Agent mit frischem Kontext den Diff gegen `origin/alpha` mit der Prüfliste
(`dev-zunder-ausfuehren/references/review-pruefliste.md`) prüfen; eine Gegenprüfung je Befund ist
nicht verlangt. Die PR-Beschreibung MUST NOT einen Abschnitt „Review“ verlangen.

#### Scenario: Umsetzung fertig, niemand verlangt einen Review
- **WHEN** ein Task auf der Route `klar` umgesetzt und verifiziert ist
- **THEN** öffnet der Main-Loop den PR nach den Gates, ohne einen Review-Agenten zu starten

#### Scenario: Der Mensch verlangt einen Review
- **WHEN** der Mensch vor dem PR einen Review verlangt
- **THEN** prüft ein Agent mit frischem Kontext den Diff des Branches gegen die Prüfliste und
  liefert Befunde zurück, die der Main-Loop behandelt
