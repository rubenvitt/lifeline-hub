# Proposal

Zunder: LLH-1898 (https://zunder.rubeen.dev/#/aufgabe/r7bpwsdepdj05cmdt0kookiu)

## Why

Die Regel für das Label `voll` ist weich: „Ist die Änderung riskant (UI-Abläufe,
Backend-Verhalten, CI) … setzt du das Label `voll`“ (Skill `dev-zunder-ausfuehren`, ADR-0048
SHOULD, PR-Vorlage). Nach dieser Lesart ist fast jede Änderung riskant. Ein PR mit `voll` belegt
rund eine Stunde Runner und konkurriert mit den Läufen auf `alpha`. Ruben am 15.11.2026: „Es
sollte ganz strikte Kriterien geben, wann `voll` dran kommt, und das soll die Seltenheit bleiben.“

## What Changes

- `voll` setzt ein Agent nur noch, wenn **mindestens eines** zutrifft:
  1. Der PR ändert, **wie die Suiten selbst laufen**: `suiten.yml`, `e2e.yml`, `scripts/runner/`,
     die Konfiguration von Playwright (`frontend/playwright*.config.ts`) oder Vitest
     (`frontend/vite*.config.ts`, `frontend/vitest*.config.ts`).
  2. Der Mensch verlangt es ausdrücklich.
- Ausdrücklich **kein** Grund: „riskant“, Backend-Verhalten, UI-Abläufe, Migrationen, CI-Änderungen
  außerhalb der Suiten. Dafür gilt lokal `check-all.sh --geaendert --ohne-e2e`, bei UI-Abläufen
  dazu gezielt die betroffene e2e-Spec lokal.
- Die Regel steht genau einmal in `scripts/AGENTS.md` („Leichte PR-Prüfung“); Skill, PR-Vorlage und
  Wurzel-`AGENTS.md` verweisen darauf.
- Eine neue ADR präzisiert das SHOULD aus ADR-0048.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

(keine: Regel für Agenten, das Verhalten der CI ändert sich nicht; `skip_specs: true`)

## Impact

- Doku/Regeln: `scripts/AGENTS.md`, `.claude/skills/dev-zunder-ausfuehren/SKILL.md`,
  `.github/pull_request_template.md`, neue ADR.
- Kein Code, kein Workflow.
