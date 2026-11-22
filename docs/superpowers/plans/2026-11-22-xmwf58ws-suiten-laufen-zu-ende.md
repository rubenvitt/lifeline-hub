# Suiten laufen auf Kanal-Branches zu Ende — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die fünf Testjobs in `suiten.yml` brechen bei einem neuen Push auf einen Kanal-Branch nicht mehr ab, sondern laufen zu Ende; Formtest, ADR und Regeltext ziehen mit.

**Architecture:** Nur `cancel-in-progress` der Job-Concurrency wechselt von `true` auf `false`; Gruppen bleiben. Eine neue ADR löst die eine Abbruch-Regel aus ADR-0048 ab und prüft die Form maschinell.

**Tech Stack:** GitHub-Actions-YAML, Bash-Formtest (`scripts/ci-stufen.test.sh`), ADR-Wächter (`scripts/check-architektur.sh`).

**Spec:** `docs/superpowers/specs/2026-11-22-xmwf58ws-suiten-laufen-zu-ende-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/xmwf58ws0mnu4ulowan9aeys (LLH-2035)

## Global Constraints

- Gruppen bleiben wortgleich: `ci-<job>-${{ github.event_name == 'push' && github.ref || github.run_id }}` (frontend mit `-${{ matrix.shard }}`).
- Release-Job in `ci.yml` bleibt unverändert (eigene Gruppe, `cancel-in-progress: false`, `needs`).
- ADR-Prüfung: nur `verbiete`/`verlange`, `awk`, `grep`; unter einer Sekunde; Bash 3.2; ADR unter 80 Zeilen.
- Prosa deutsch; ADR `akzeptiert` ist unveränderlich — ADR-0048 wird nicht editiert.

## Review Focus

- Ein Job behält `cancel-in-progress: true` (Tippfehler in einem der fünf) → Formtest und ADR-Prüfung müssen rot werden (Gegenprobe in Task 2).
- Ein Kommentar enthält „cancel-in-progress: true“ → darf die ADR-Prüfung nicht täuschen (Prüfung liest nur Codezeilen).
- `berichte` mit `if: ${{ !cancelled() }}` bleibt; die Prüfung „berichte nur ohne Abbruch“ im Formtest bleibt unverändert.

---

### Task 1: Formtest und `suiten.yml`

**Files:**
- Modify: `scripts/ci-stufen.test.sh` (fünf Zeilen `pruefe "<job>: Gruppe je Branch mit Abbruch" …|true"`)
- Modify: `.github/workflows/suiten.yml` (Kopf „ABBRUCH AUF KANAL-BRANCHES“, Kommentar am Job `rust`, fünfmal `cancel-in-progress`)

- [x] **Step 1:** Formtest: die fünf Gruppenprüfungen erwarten `|false` und heißen „… ohne Abbruch (läuft zu Ende)“.
- [x] **Step 2:** `bash scripts/ci-stufen.test.sh` → FAIL bei genau diesen fünf Prüfungen.
- [x] **Step 3:** `suiten.yml`: fünfmal `cancel-in-progress: false`; Kopf heißt „ZU ENDE AUF KANAL-BRANCHES (LLH-2035, ADR-0084)“ und erklärt: laufender Job endet, höchstens ein wartender je Gruppe, ein neuer Push ersetzt nur den wartenden; im PR je Lauf. Kommentar am Job `rust` entsprechend.
- [x] **Step 4:** `bash scripts/ci-stufen.test.sh` → alles grün.
- [x] **Step 5:** Commit `ci(suiten): Testjobs auf Kanal-Branches laufen zu Ende (LLH-2035)`.

### Task 2: ADR-0084

**Files:**
- Create: `docs/architektur/entscheidungen/ADR-0084-testjobs-auf-kanal-branches-laufen-zu-ende.md`

- [x] **Step 1:** Nummer prüfen: `git fetch origin alpha` und `git ls-tree origin/alpha docs/architektur/entscheidungen/` → höchste ist 0081; offene PRs mit neuer ADR per `gh api -X GET search/issues -f q='repo:rubenvitt/lifeline-hub is:pr is:open ADR-0084'`.
- [x] **Step 2:** ADR schreiben nach `VORLAGE.md`. Kopf: `status: akzeptiert`, `datum: 2026-11-22`, kein `ersetzt` (Teilablösung), `gilt_fuer`: `.github/workflows/suiten.yml`, `scripts/ci-stufen.test.sh`, `scripts/AGENTS.md`; `herleitung`: Design-Doc + Zunder LLH-2035. Regeln:
  - MUST: Aus ADR-0048 entfällt „Auf einem Kanal-Branch bricht ein neuer Push die Testjobs des laufenden Laufs ab“.
  - MUST: Die Testjobs in `suiten.yml` (`rust`, `frontend` je Anteil, `e2e`, `ios`, `berichte`) haben Concurrency je Branch und Job mit `cancel-in-progress: false`; ein gestarteter Job läuft zu Ende.
  - MUST NOT: `cancel-in-progress: true` in `suiten.yml`.
  - MUST: Der Release bleibt wie in ADR-0048 (eigene Gruppe ohne Abbruch, `needs`); ein überholter Lauf released nicht (`scripts/release-ruhefenster.sh`).
  - SHOULD: Neu gestartet wird nur ein Job des jüngsten Laufs (`scripts/AGENTS.md`, „Leichte PR-Prüfung“).
  Prüfung:
  ```sh
  verbiete '^[^#]*cancel-in-progress:[[:space:]]*true' .github/workflows/suiten.yml
  test "$(grep -cE '^      cancel-in-progress: false$' .github/workflows/suiten.yml)" -eq 5
  ```
- [x] **Step 3:** Gegenprobe: in einer Kopie `/tmp`-frei per `sed` einen Job auf `true` setzen → Prüfung rot (`bash -euo pipefail` über den Block mit `scripts/lib/adr.sh`); Datei danach unverändert (`git diff --quiet .github/workflows/suiten.yml` bzw. Stand aus Task 1).
- [x] **Step 4:** `bash scripts/check-architektur.sh` → grün.
- [x] **Step 5:** Commit `docs(adr): ADR-0084 Testjobs auf Kanal-Branches laufen zu Ende (LLH-2035)`.

### Task 3: Regeltext und Verweise

**Files:**
- Modify: `scripts/AGENTS.md` (Absatz „Auf `alpha`, `beta`, `main`“ unter „Leichte PR-Prüfung“)
- Prüfen: `.github/workflows/release.yml` Kopf, `scripts/stau-waechter.sh` Hinweistext (Zeile mit „bräche die Tests des jüngeren ab“)

- [x] **Step 1:** Absatz umschreiben: Testjobs laufen zu Ende (ADR-0084), höchstens ein wartender Lauf je Job, ein neuer Push ersetzt nur den wartenden, der jüngste Lauf deckt übersprungene Zwischenstände ab. Release-Satz bleibt. „Neu starten nur den jüngsten Lauf“: ein neu gestarteter Job eines älteren Laufs tritt als wartender in die Gruppe und verdrängt den wartenden des jüngeren.
- [x] **Step 2:** `grep -rn 'bricht die Testjobs\|bräche die Tests\|bricht die Tests\|Tests ein neuer Push abbrach\|abgebrochen hat' scripts .github docs/architektur .claude` → jede Fundstelle prüfen; aktive Texte (nicht akzeptierte ADRs, nicht Archiv) an das neue Verhalten anpassen, wenn sie sonst falsch würden. Stau-Wächter-Text: „verdrängte den wartenden Lauf des jüngeren“; dessen Test (`stau-waechter.test.sh`) mitziehen, falls er den Wortlaut prüft.
- [x] **Step 3:** `bash scripts/stau-waechter.test.sh` (falls Text geändert) und `bash scripts/ci-stufen.test.sh` → grün.
- [x] **Step 4:** Commit `docs(ci): Regeltext – Testjobs laufen zu Ende (LLH-2035)`.

### Task 4: Gate

- [x] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün (Ergebnis in den PR unter „Geprüft“).
  Lauf 22.11.2026: Bündel `schnell` lokal grün (alle Schritte). Rust-Suite (Schritt 4) scheiterte am
  Plattenkontingent der Cloud-Sitzung, Frontend-Suite (Schritt 5) überschritt das Zeitlimit von 90 min
  mit einem Vitest-Worker; der Diff berührt weder Rust- noch Frontend-Code. Beide fährt der PR mit
  Label `voll` in der CI (Verweis statt lokalem Lauf).
- [x] **Step 2:** PR gegen `alpha` mit Label `voll` (ADR-0050, Kriterium 1).
