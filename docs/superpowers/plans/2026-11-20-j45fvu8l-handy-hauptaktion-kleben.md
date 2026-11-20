# Handy: Hauptaktion kleben, Auftragsdetail in den Blick — Umsetzungsplan (LLH-1761)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Am Handy (und Handschuh-Tablet) bleibt „Erfassen“ der Aufnahme und von „Meldung erfassen“ unten im Bild, auch über der Tastatur; ein Tipp auf einen Auftrag holt dessen Detail in den Blick.

**Architecture:** `ErfassungsFormular.fussKlebt` wird von `boolean` zu `'dialog' | 'seite'`; die Seite klebt mit eigenem Grund und eigener Fokusabstand-Variable. Ein Hook `useTastaturVersatz` misst per VisualViewport die von der Tastatur verdeckte Höhe und setzt sie als `bottom` des klebenden Fußes. `ListeDetail` rollt unter `lg` nach einer Wahl von Hand den Eintrag nach oben, wenn das Detail unter den Fensterrand fällt.

**Tech Stack:** React 19, antd, Vitest + Testing Library, Playwright (`mise exec -- pnpm …` in `frontend/`).

**Spec:** `docs/superpowers/specs/2026-11-20-j45fvu8l-handy-hauptaktion-kleben-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/j45fvu8l47a0snwv5gxrrsje

## Global Constraints

- Prosa (Kommentare, Tests, Commits) deutsch; Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, LLH-1312).
- Kein Viewport-Meta-Umbau in `index.html`; ETB-Erfassung unverändert.
- Gerollt wird nur nach einer Wahl von Hand, nur unter `lg`, nie beim Deeplink, bei der Vorauswahl oder beim Zuklappen.
- Unter `prefers-reduced-motion: reduce` kein `smooth`.
- Fehlt `window.visualViewport`, ist der Versatz 0.
- Prettier über `frontend/` inklusive `AGENTS.md`.

## Review Focus

- Tastatur offen, Fokus wandert aus dem Formular (etwa in die Kopfsuche): der Fuß fällt auf `bottom: 0` zurück, statt mitten im Bild zu schweben. → Test in Task 1.
- Seitenformular und Dialog gleichzeitig offen (Aufnahme + Dialog darüber): jeder Fuß misst seine eigene Variable, das Schließen des Dialogs räumt die der Seite nicht. → Test in Task 2.
- Kurze Seite (Formular passt ins Fenster): der Fuß steht unverändert unter dem letzten Feld (`sticky` ohne Wirkung) — e2e in Task 4 auf Desktop-Breite kein Versatz.
- Erneuter Tipp auf die aufgeklappte Karte (Zuklappen) rollt nicht. → Test in Task 3.
- Detail passt schon ins Fenster: kein Rollen (sonst springt die Liste bei jedem Tipp). → Test in Task 3.

---

### Task 1: Hook `useTastaturVersatz`

**Files:**
- Create: `frontend/src/components/tastaturVersatz.ts`
- Test: `frontend/src/components/tastaturVersatz.test.ts`

**Interfaces:**
- Produces: `useTastaturVersatz(wurzel: RefObject<HTMLElement | null>): number` — verdeckte Höhe in px, `0` ohne Fokus im `wurzel`, ohne VisualViewport oder ohne Tastatur. Formel: `Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))`. Hört auf `focusin`/`focusout` am `wurzel` (`focusout` mit `relatedTarget` außerhalb → 0) und auf `resize`/`scroll` des `visualViewport`, solange der Fokus drin ist.

- [ ] **Step 1: Failing tests** (`renderHook`, gefälschter `window.visualViewport` als `EventTarget` mit `height`/`offsetTop`, `innerHeight = 844`):
  - `ohne Fokus im Formular ist der Versatz 0` — vv.height 500 → `0`.
  - `mit Fokus und offener Tastatur rückt der Versatz um die verdeckte Höhe` — Fokus auf Input im wurzel, vv.height 500, offsetTop 0, `resize` feuern → `344`.
  - `verlässt der Fokus das Formular, fällt der Versatz auf 0` — danach Fokus auf Element außerhalb → `0`.
  - `ohne VisualViewport bleibt der Versatz 0` — `visualViewport` undefined, Fokus drin → `0`.
- [ ] **Step 2:** `mise exec -- pnpm vitest run src/components/tastaturVersatz.test.ts` → FAIL (Modul fehlt).
- [ ] **Step 3:** Implementieren (`useSyncExternalStore` nicht nötig; `useState` + `useEffect`).
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5:** Commit `feat: Tastaturversatz für klebende Fußleisten (LLH-1761)`.

### Task 2: Fuß klebt auf der Seite und über der Tastatur

**Files:**
- Modify: `frontend/src/components/Erfassung.tsx` (Prop `fussKlebt`, `klebenderFuss`, Dateikopf „Im Dialog klebt der Fuß …“, `ErfassungsModal` → `fussKlebt="dialog"`)
- Modify: `frontend/src/components/fokusabstandUnten.ts` (neue Konstante `FOKUSABSTAND_ERFASSUNG_SEITE = '--lfh-erfassung-seite-fokusabstand'`)
- Modify: `frontend/src/index.css` (`:root:has([data-lfh='erfassung-fuss-seite']) { scroll-padding-block-end: var(--lfh-erfassung-seite-fokusabstand, 0px); }` neben der Dialogregel)
- Modify: `frontend/src/pages/personen/AufnahmePage.tsx`, `frontend/src/meldungen/MeldungFormular.tsx` (nur die Inline-Form) → `fussKlebt="seite"`
- Test: `frontend/src/components/Erfassung.test.tsx`

**Interfaces:**
- Consumes: `useTastaturVersatz` (Task 1).
- Produces: `fussKlebt?: 'dialog' | 'seite'`; `data-lfh` = `erfassung-fuss` (Dialog, unverändert) bzw. `erfassung-fuss-seite`. Stil Seite: `position: sticky`, `bottom: versatz`, `zIndex: 1`, `background: token.colorBgContainer`, kein negativer Rand. Dialog: wie bisher, `bottom: versatz`.

- [ ] **Step 1: Failing tests:**
  - `auf der Seite klebt der Fuß mit eigenem Grund` — `fussKlebt="seite"` → Element `[data-lfh="erfassung-fuss-seite"]` hat `position: sticky`, `bottom: 0px`, kein negatives `margin-bottom`.
  - `ohne fussKlebt klebt nichts` — kein `data-lfh` mit `erfassung-fuss`.
  - `Seite und Dialog messen getrennte Variablen` — Seite + Modal gemountet, Modal schließen → `--lfh-erfassung-seite-fokusabstand` bleibt an `<html>` gesetzt.
  - `mit Fokus und offener Tastatur rückt der Seitenfuß nach oben` — gefälschter VisualViewport (wie Task 1), Fokus ins erste Feld → `bottom: 344px`.
- [ ] **Step 2:** `mise exec -- pnpm vitest run src/components/Erfassung.test.tsx` → neue Tests FAIL.
- [ ] **Step 3:** Implementieren; Dateikopf und JSDoc des Props umschreiben (Seite klebt jetzt, Tastatur).
- [ ] **Step 4:** Erfassung-Tests + `src/pages/personen/AufnahmePage.test.tsx` + Meldung-Tests → PASS; `mise exec -- pnpm tsc --noEmit -p .` grün.
- [ ] **Step 5:** Commit `feat: Erfassungsfuß klebt auf der Seite und über der Tastatur (LLH-1761)`.

### Task 3: `ListeDetail` holt das Detail unter `lg` in den Blick

**Files:**
- Modify: `frontend/src/components/ListeDetail.tsx` (in `select` die Wahl von Hand merken: `handWahl = useRef<number | null>(null)`, gesetzt nur, wenn die Wahl öffnet, nicht beim Zuklappen; `useLayoutEffect` nach dem Rendern)
- Test: `frontend/src/components/ListeDetail.test.tsx` (Block „Handschirm“)

**Interfaces:**
- Produces: nach Wahl von Hand unter `lg`: liegt `[data-lfh="liste-detail-detail"]` mit `getBoundingClientRect().bottom > window.innerHeight`, dann `eintrag.scrollIntoView({ block: 'start', behavior })` mit `behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'`; `handWahl` wird danach geräumt (einmal je Wahl).

- [ ] **Step 1: Failing tests** (Handschirm, `scrollIntoView` als `vi.fn()`, `getBoundingClientRect` des Details gestubbt):
  - `eine Wahl von Hand rollt das aufgeklappte Detail in den Blick, wenn es unter den Rand fällt` — bottom 1200 bei innerHeight 844 → `scrollIntoView` einmal mit `{ block: 'start', … }` am `li[data-liste-detail-eintrag]`.
  - `passt das Detail ins Fenster, rollt nichts` — bottom 600 → nicht gerufen.
  - `Zuklappen rollt nicht` — zweiter Klick auf dieselbe Karte → kein weiterer Aufruf.
  - `ab lg rollt die Wahl nicht` — breit → nicht gerufen.
- [ ] **Step 2:** `mise exec -- pnpm vitest run src/components/ListeDetail.test.tsx` → neue Tests FAIL; Deeplink-Test bleibt grün.
- [ ] **Step 3:** Implementieren; Kommentar mit Verweis auf LLH-1761.
- [ ] **Step 4:** ListeDetail-, AuftraegeListe- und BefehlListe-Tests → PASS.
- [ ] **Step 5:** Commit `feat: Liste + Detail holt das Detail am Handschirm in den Blick (LLH-1761)`.

### Task 4: Regeln und e2e

**Files:**
- Modify: `frontend/AGENTS.md` — Erfassungs-Norm: neuer Punkt „**Der Fuß klebt** im Dialog (`fussKlebt="dialog"`, LLH-1274) und auf Seiten mit langer Maske (`"seite"`, Aufnahme, Meldung; LLH-1761); mit Fokus im Formular rückt er über die Bildschirmtastatur (`components/tastaturVersatz.ts`, VisualViewport).“ — Liste + Detailpaneel: Halbsatz „unter `lg` holt die Wahl von Hand das Detail in den Blick, wenn es unter den Rand fällt (LLH-1761)“.
- Modify: `frontend/e2e/meldungen-handy.spec.ts`, `frontend/e2e/betroffene-handy.spec.ts` (Aufnahme), `frontend/e2e/auftraege-befehle-liste-detail.spec.ts`

- [ ] **Step 1: e2e-Tests** (Handy-Projekt, 390 × 844):
  - Meldung erfassen aufgeklappt → Knopf „Erfassen“ (bzw. Primärknopf) `boundingBox().y + height <= 844` ohne Rollen.
  - Aufnahme geöffnet → „Erfassen“ im Fenster ohne Rollen.
  - Auftrag antippen → Knopf „Quittieren“ (falls Demo-Auftrag mit offener Quittung; sonst erster Knopf des Details) liegt nach dem Rollen im Fenster (`toBeInViewport()`).
- [ ] **Step 2:** Lauf `mise exec -- pnpm exec playwright test <dateien> --trace off` → grün.
- [ ] **Step 3:** `frontend/AGENTS.md` ergänzen, Prettier.
- [ ] **Step 4:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [ ] **Step 5:** Commit `docs: Regeln zu klebendem Erfassungsfuß und Detail in den Blick (LLH-1761)`.
