# Proposal

Zunder: LLH-1894 (https://zunder.rubeen.dev/#/aufgabe/czjhc4qqnxtn7qwgs8nnjoz7) mit LLH-1895
(https://zunder.rubeen.dev/#/aufgabe/q10lxu1ujos7wf1ev5ovc4cx) und LLH-1896
(https://zunder.rubeen.dev/#/aufgabe/z12s72u9fi59k0pou4z12lum).

## Why

Am Abend des 14.11.2026 bekam `Migrationsnummern` im Ruleset von `alpha` beim Austragen der Suiten
die Quelle „GitHub Actions“. Der Status wird über die Status-API gesetzt und zählt mit diesem Pin
nicht: Alle grünen PRs standen über Nacht auf `blocked`, der Stau-Wächter meldete nur „Grün, aber
nicht gemergt“, und aufgefallen ist es erst am nächsten Morgen. Dazu trägt ein nicht fertiger PR
ohne `voll` neun übersprungene Einträge; sieben davon stammen aus Jobs, die am PR ohne `voll` nie
laufen (drei davon nur bei Push), zwei (`Kompilieren`, `Melden`) gehören zum Pflicht-Check.
Ruben wünscht eine kleinere CI am PR und will einen Fehler im Ruleset sofort bemerken.

## What Changes

- **Ruleset-Wächter (LLH-1895):** Ein neuer Workflow liest bei jedem Push auf `alpha`, alle sechs
  Stunden und auf Anstoß die Regeln von `alpha` und vergleicht die Pflicht-Checks mit einer Liste,
  die genau an einer Stelle im Repository steht. Abweichung (fehlende oder
  zusätzliche Pflicht, Quelle an einem per API gesetzten Status, Pflicht „Branches must be up to
  date“) macht den Lauf rot, also kommt eine Mail.
- **Stau-Wächter nennt die Ursache:** Der Hinweis „Grün, aber nicht gemergt“ nennt die Abweichung
  im Ruleset, wenn es eine gibt.
- **Weniger Einträge am PR (LLH-1896):**
  - `ci.yml` läuft nur noch bei einem Push auf einen Kanal-Branch: Schnellprüfungen, die Suiten
    (neu gebündelt in einem wiederverwendbaren Workflow) und der Release.
  - Ein neuer PR-Workflow fährt die Schnellprüfungen und, nur mit dem Label `voll`, die Suiten.
    Der Job heißt weiter `Schnellprüfungen`, die Pflicht-Check-Namen bleiben.
  - `Verteilen` (Baut mit Ziel-Branch) und `Offene PRs neu bewerten` (Migrationsnummern) ziehen in
    eigene Workflows, die nur bei einem Push laufen.
  - Am PR ohne `voll` bleibt aus `pr.yml` genau ein übersprungener Eintrag: der Aufruf der Suiten.
    `Kompilieren` und `Melden` des Pflicht-Checks bleiben an einem nicht fertigen PR übersprungen.
- **ADR:** Eine neue ADR ersetzt ADR-0047, weil sich deren Regeln auf Jobs in `ci.yml` beziehen.

## Capabilities

### New Capabilities

- `ruleset-pflichtchecks`: Das Ruleset von `alpha` trägt genau die vereinbarten Pflicht-Checks in
  einer Form, die GitHub erfüllen kann; eine Abweichung fällt sofort als roter Lauf auf.

### Modified Capabilities

- `pr-pruefstufen`: Ein PR ohne `voll` zeigt keine Jobs, die nur auf Kanal-Branches laufen.
- `merge-stau`: Der Hinweis zu einem grünen, nicht gemergten PR nennt eine Abweichung im Ruleset.

## Impact

- Workflows: `.github/workflows/ci.yml` (nur Push), neu `pr.yml`, `suiten.yml`,
  `ziel-branch-verteilen.yml`, `migrationen-kanal.yml`, `ruleset.yml`; angepasst
  `ziel-branch-build.yml`, `migrationen.yml`, `e2e.yml` (Kopfkommentar).
- Skripte: neu `scripts/ruleset-pruefen.sh` mit Selbsttest; angepasst `scripts/stau-waechter.sh`,
  `scripts/ziel-branch-build.sh`, `scripts/ci-messung.sh`, `scripts/check-all.sh` sowie die
  Selbsttests `ci-stufen`, `ziel-branch-build`, `stau-waechter`, `ci-messung`.
- Doku: `scripts/AGENTS.md` („Leichte PR-Prüfung“), neue ADR statt ADR-0047, Kapitel 7, README.
- Kein Eingriff ins Ruleset nötig: Die Pflicht-Check-Namen bleiben gleich.
- Auf `alpha` heißen die Suiten-Jobs künftig `Suiten / Rust-Suite` usw.
