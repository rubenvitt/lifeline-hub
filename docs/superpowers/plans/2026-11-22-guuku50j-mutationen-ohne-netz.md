# Mutationen ohne Netz sofort scheitern lassen — Umsetzungsplan (LLH-1950)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ohne Netz scheitert jede Mutation sofort mit `NetzFehler`, statt zu pausieren; Erfassungsdialoge bleiben bedienbar.

**Architecture:** `erzeugeQueryClient` legt `networkMode: 'always'` unter die Mutations-Vorgaben, für Prod und jeden Testclient. Die Regel steht in `frontend/src/offline/AGENTS.md`; Kommentare, die das Pausieren als Vorgabe nennen, folgen.

**Tech Stack:** TanStack Query v5, React, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-22-guuku50j-mutationen-ohne-netz-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/guuku50jetu1zqkmbruioj69

## Global Constraints

- Queries bleiben bei TanStacks Vorgabe (`'online'`); nur Mutationen ändern sich.
- Ausdrückliche `networkMode`-Angaben an einzelnen Mutationen bleiben stehen und gewinnen.
- Der Vergleich `defaultOptions === queryClientDefaults` in `erzeugeQueryClient` prüft weiter die übergebene Eingabe.
- Node/pnpm nur über `mise exec -- …`; Prosa und Testnamen deutsch.

## Review Focus

- Eine Mutation mit eigenem `networkMode: 'online'` behält es (Vorgabe überschreibt nichts Ausdrückliches) — Test in Task 1.
- Ein Testclient mit eigenen Mutations-Vorgaben (`{ mutations: { retry: false } }`) bekommt `'always'` trotzdem — Test in Task 1.
- Offline-Fehler eines Anlegens meldet „Server nicht erreichbar“ weiter über den `MutationCache`-Seam (unverändert, `istVerbindungsfehler`) — kein neuer Test, bestehender Seam.
- Abbrechen nach dem Offline-Fehler schließt den Dialog (mit Verwerfen-Rückfrage) — Test in Task 2.

---

### Task 1: Vorgabe in der Fabrik

**Files:**
- Modify: `frontend/src/api/queryClient.ts` (`queryClientDefaults`-Kommentar, `erzeugeQueryClient`)
- Test: `frontend/src/api/queryClient.test.ts`

**Interfaces:**
- Produces: `erzeugeQueryClient(defaultOptions?)` — Mutationen laufen mit `networkMode: 'always'`, sofern weder `defaultOptions.mutations.networkMode` noch die Mutation selbst etwas anderes setzt.

- [x] **Step 1: Failing tests** in neuem `describe('erzeugeQueryClient — Mutationen pausieren nie (LLH-1950)')`, je mit `onlineManager.setOnline(false)` und `finally` zurück auf `true`:
  - `'ruft die mutationFn ohne Netz sofort auf (Prod-Vorgaben)'`: `erzeugeQueryClient()`, Mutation über `getMutationCache().build(...).execute()` mit `mutationFn = vi.fn().mockRejectedValue(new NetzFehler())`; nach `await …catch` → `mutationFn` einmal aufgerufen, `state.isPaused === false`, `state.status === 'error'`.
  - `'… auch mit eigenen Mutations-Vorgaben'`: dasselbe mit `erzeugeQueryClient({ mutations: { retry: false } })`.
  - `'lässt ein ausdrückliches networkMode an der Mutation stehen'`: Mutation mit `networkMode: 'online'`, nach einem Takt → `isPaused === true`, `mutationFn` nicht aufgerufen.
- [x] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/api/queryClient.test.ts` → die ersten beiden FAIL (pausiert).
- [x] **Step 3:** In `erzeugeQueryClient` `defaultOptions: { ...defaultOptions, mutations: { networkMode: 'always', ...defaultOptions.mutations } }` an den `QueryClient` geben; Kommentar am Seam (warum nie pausieren: kein stilles Nachsenden, Erfassungshülle sperrt sonst).
- [x] **Step 4:** Lauf wie Step 2 → PASS.
- [x] **Step 5:** Commit `fix(frontend): Mutationen ohne Netz scheitern sofort statt zu pausieren (LLH-1950)`.

### Task 2: Anlegedialog ohne Netz bedienbar

**Files:**
- Test: `frontend/src/components/AnlegenModal.test.tsx`

**Interfaces:**
- Consumes: Task 1; `setzeOnline` aus `test/utils.tsx`; `NetzFehler` aus `api/client.ts`.

- [ ] **Step 1: Test** `'ohne Netz: zeigt den Grund im Dialog, Abbrechen schließt (LLH-1950)'`: `setzeOnline(false)` (in `try/finally` zurück auf `true`), `lege = vi.fn().mockRejectedValue(new NetzFehler())`, `legeAn()` → `lege` einmal aufgerufen; `findByRole('alert')` enthält `'NICHT abgeschickt'`; Knopf „Abbrechen“ nicht `disabled`; Klick + `bestaetigeVerwerfen()` → Zustand `'zu'`.
- [ ] **Step 2:** Gegenprobe: Task-1-Änderung vorübergehend zurücknehmen → Test FAIL (Alert erscheint nicht / `lege` nicht aufgerufen); wieder herstellen → PASS. Lauf: `mise exec -- pnpm -C frontend exec vitest run src/components/AnlegenModal.test.tsx`.
- [ ] **Step 3:** Commit `test(frontend): Anlegedialog ohne Netz bleibt bedienbar (LLH-1950)`.

### Task 3: Regel und Kommentare

**Files:**
- Modify: `frontend/src/offline/AGENTS.md` (Abschnitt „Schreiben ohne Netz“, erster Punkt)
- Modify: Kommentare, die das Pausieren als Vorgabe nennen: `frontend/src/offline/lagebildFilter.ts:124`, `frontend/src/api/lagebildOffline.guard.test.ts:231`, `frontend/src/command-palette/VorschauZustand.tsx:18` (nur wenn er Mutationen meint; bei Queries stehen lassen); grep `networkMode` nach weiteren.

- [ ] **Step 1:** Regel in `offline/AGENTS.md`: Mutationen pausieren nie — `erzeugeQueryClient` setzt `networkMode: 'always'` als Vorgabe; ohne Netz scheitern sie mit `NetzFehler`, die Erfassungshülle zeigt den Grund; was ohne Netz gelten soll, geht über die Offline-Queue. Herleitung: Spec-Pfad.
- [ ] **Step 2:** Kommentare anpassen.
- [ ] **Step 3:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [ ] **Step 4:** Commit `docs(frontend): Regel „Mutationen pausieren nie“ (LLH-1950)`.
