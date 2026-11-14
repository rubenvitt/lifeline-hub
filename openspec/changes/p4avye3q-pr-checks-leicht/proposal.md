# Proposal

## Why

Am 14.11.2026 trug ein einzelner PR 42 Check-Einträge. Jeder fertige PR fuhr Rust-, Frontend- und e2e-Suite (rund eine Stunde Runner-Zeit). Gleichzeitig hingen zehn PRs, weil jeder Merge auf `alpha` die Prüfungen aller fertigen PRs neu anstieß. Ein zeitabhängiger Test machte zudem jeden offenen PR rot, nicht nur `alpha`. Ruben hat entschieden: PR-Checks werden wirklich leicht, die schweren Suiten laufen auf `alpha` und lassen sich dort abbrechen (LLH-1889, Erweiterung vom 14.11.).

## What Changes

- **BREAKING (Ruleset):** Ein PR trägt als Pflicht nur noch `Schnellprüfungen`, `Migrationsnummern` und `Baut mit Ziel-Branch`. `Rust-Suite`, `Frontend-Suite 1/4`–`4/4`, `e2e-Binary` und `e2e 1/4`–`4/4` laufen im PR nicht mehr. Ruben trägt sie unmittelbar vor dem Merge aus dem Ruleset 17017911 aus.
- **Label `voll`:** Ein PR mit dem Label `voll` fährt alle Suiten ganz (Rust, Frontend, e2e), ohne Pflicht. Das Label `e2e` und die „zweite Stufe“ (LLH-1662) entfallen.
- **Fertig heißt Auto-Merge an:** „Baut mit Ziel-Branch“ rechnet nur noch an PRs mit eingeschaltetem Auto-Merge. Labels zählen nicht.
- **Kanal-Branches prüfen voll und brechen ab:** Ein Push auf `alpha`, `beta` oder `main` fährt alle Suiten. Ein neuer Push bricht die Testjobs des laufenden Laufs ab, der jüngste Lauf deckt alle früheren mit ab. Ein Release, der schon läuft, bricht nie ab. Ein Release entsteht nur aus einem Lauf, dessen Tests alle grün sind.
- **Auswahl nach Bereichen entfällt in der CI:** `scripts/ci-auswahl.sh` und `scripts/nur-umnummeriert.sh` samt Selbsttests werden entfernt. Lokal bleibt die Auswahl (`check-all.sh --geaendert`, `scripts/bereiche.sh`).
- **Lokal vor dem PR:** `check-all.sh` bekommt `--ohne-e2e`. Agenten fahren vor dem PR `check-all.sh --geaendert --ohne-e2e` (Skill `dev-zunder-ausfuehren`, PR-Vorlage).
- **Stau-Wächter:** Der Befund „Auto-Merge an, e2e-Stufe fehlt“ entfällt. Ein abgebrochener `alpha`-Lauf zählt bei „alpha rot“ nicht.
- **Architektur:** Eine neue ADR ersetzt ADR-0026. ADR-0025 bekommt Pfadnachzüge, Kapitel 7 wird nachgezogen.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `pr-pruefstufen`: Die zweite Stufe und das Label `e2e` entfallen. Neu sind die leichte PR-Prüfung, das Label `voll` und der Abbruch auf Kanal-Branches ohne Abbruch des Release. „Fertig“ heißt Auto-Merge an.
- `merge-stau`: Der Befund „Auto-Merge ohne e2e-Lauf“ entfällt. „Grün, nicht gemergt“ verliert den Bezug zur zweiten Stufe. Ein abgebrochener alpha-Lauf zählt bei „alpha rot“ nicht.
- `migrationsvergabe`: Nach einer Umnummerierung laufen im PR nur `Migrationsnummern` und die Schnellprüfungen, die Übernahme grüner Suiten entfällt.
- `dev-seed-gate`: Ein roter Dev-Seed-Schritt sperrt nicht mehr den PR über einen Pflicht-Check, sondern zeigt sich auf `alpha` und im `voll`-Lauf.
- `ci-eigener-runner`: Die e2e-Jobs laufen im PR nur mit `voll`. Das Szenario zu den Required Checks entfällt.

## Impact

- Workflows: `ci.yml`, `e2e.yml` (nur noch `workflow_call`), `ziel-branch-build.yml`, `coverage.yml` (Kopf), `release.yml` (Kopf)
- Skripte: `check-all.sh` (`--ohne-e2e`), `stau-waechter.sh`, `ziel-branch-build.sh`, `ci-messung.sh`, `runner/*`, `e2e-anteile.mjs`. Entfernt werden `ci-auswahl.sh` und `nur-umnummeriert.sh`. Die Selbsttests `ci-stufen.test.sh`, `stau-waechter.test.sh`, `ziel-branch-build.test.sh`, `runner/ci-schritte.test.sh` und `check-all.test.sh` werden angepasst.
- Regeln und Doku: `scripts/AGENTS.md`, Wurzel-`AGENTS.md`, `frontend/e2e/AGENTS.md`, `README.md`, `.github/pull_request_template.md`, Skill `dev-zunder-ausfuehren`, ADR neu, ADR-0026 auf ersetzt, ADR-0025 nachgezogen, `docs/architektur/07-verteilungssicht.md`, `frontend/playwright.config.ts` (Verweis).
- **Handgriff Ruben, vor dem Merge:** Ruleset 17017911 auf `Schnellprüfungen`, `Migrationsnummern`, `Baut mit Ziel-Branch` (und, wie bisher, `ADR-Nummern`) reduzieren.
- Folge: Brüche, die erst ein Test zeigt, landen auf `alpha`. Dort fängt sie der alpha-rot-Ablauf des Stau-Wächters.
