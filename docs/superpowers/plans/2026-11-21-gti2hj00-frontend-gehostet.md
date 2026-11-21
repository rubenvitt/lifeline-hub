# Frontend-Anteile wieder auf GitHub — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Job `frontend` in `suiten.yml` läuft immer gehostet.
**Spec:** `docs/superpowers/specs/2026-11-21-gti2hj00-frontend-gehostet-design.md`

## Review Focus

- Ein PR- oder Push-Lauf ohne `E2E_RUNNER` bleibt unverändert auf GitHub (Wächter `ci-stufen`).

### Task 1: Frontend gehostet, Wächter, ADR, Doku

**Files:** `.github/workflows/suiten.yml`, `.github/workflows/ci.yml` (Kopf),
`scripts/ci-stufen.test.sh`, `scripts/runner/ci-schritte.test.sh`, ADR-0076, `scripts/runner/README.md`,
`scripts/AGENTS.md`, `docs/architektur/07-verteilungssicht.md`

- [x] `ci-stufen.test.sh`: „frontend: bleibt auf GitHub“, „frontend: wartet nicht auf die Runner-Wahl“ → rot gesehen
- [x] `suiten.yml`: `frontend` auf `ubuntu-latest`, ohne `needs: runner` → grün
- [x] `ci-schritte.test.sh` prüft in `suiten.yml` nur noch `rust`
- [x] ADR-0076, Doku nachgezogen
- [x] `./scripts/check-all.sh --nur schnell` grün
