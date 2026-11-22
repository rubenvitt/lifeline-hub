# In einen Dialog erst klicken, wenn er steht — Umsetzungsplan (LLH-2067)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alle Kopien der seitenweiten Zoom-Warte-Zeile in `frontend/e2e/` durch `dialogSteht`/`eingeblendet` ersetzen, mit Regel und Lint-Riegel gegen Nachschub.

**Architecture:** `e2e/dialog-kern.ts` (aus LLH-2065) ist die eine Stelle, die antds Einblend-Klassen kennt. Ein `no-restricted-syntax`-Eintrag in `E2E_RIEGEL` verbietet die Klassennamen als Literal überall sonst in `e2e/**` (außer `doku-bilder/`). Die Regel steht in `frontend/e2e/AGENTS.md`.

**Tech Stack:** Playwright, TypeScript, ESLint (flat config, esquery-Selektoren).

**Spec:** `docs/superpowers/specs/2026-11-22-djjc6x03-dialog-erst-eingeblendet-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/djjc6x03jz3yp38h26sl1lxy

## Global Constraints

- Node/pnpm nur über `mise exec -- …` (LFH-773); Befehle in `frontend/`.
- `e2e/doku-bilder/**` wird nicht geändert und ist vom Riegel ausgenommen.
- Keine App-Änderung. Bezeichner: Fachbegriffe deutsch, Technik englisch (LFH-1312); bestehende
  Namen `dialogSteht`/`eingeblendet` bleiben.
- Prettier prüft `frontend/` ganz, auch `e2e/AGENTS.md`.

## Review Focus

1. Ein Dialog, den die Stelle per `.filter({ hasText })` oder Regex findet, wird mit `eingeblendet(locator)` geprüft, nicht über einen erfundenen Namen — sonst wartet der Test auf einen Dialog, den es nicht gibt (Timeout statt Befund).
2. Stellen, die vorher **nach** einem `toBeFocused()` warteten (`dokumente`, `geraet-bereitstellungsraum:266`), behalten diese Reihenfolge; der Fokus steht bei antd erst nach der Einblendung.
3. Der Riegel trifft auch Regex-Literale (`/ant-zoom-appear|…/`) und `-big-`-Varianten, nicht aber Kommentare und nicht `dialog-kern.ts` (dessen Muster ist generisch `^ant-[a-z-]+-(appear|enter)$`).
4. `betreuung-pruefliste` wartet nach der Umstellung weiter auf `.ant-motion-collapse` → 0.
5. Messende Specs (Kontrast, Trefffläche, Dichte) messen nach `eingeblendet` am selben Element wie vorher.

---

### Task 1: Riegel und Helfer-Signatur

**Files:**
- Modify: `frontend/eslint.config.js` (`E2E_RIEGEL`, Block `files: ['e2e/**/*.ts']`)
- Modify: `frontend/e2e/dialog-kern.ts` (`dialogSteht`)

**Interfaces:**
- Produces: `dialogSteht(page: Page, name: string | RegExp, { exact }?: { exact?: boolean }): Promise<Locator>`; `eingeblendet(ziel: Locator): Promise<Locator>` unverändert.
- Produces: Riegel-Meldung nennt `dialogSteht`/`eingeblendet` aus `e2e/dialog-kern.ts` und LLH-2067.

- [ ] **Step 1: Riegel eintragen** — zwei Selektoren in `E2E_RIEGEL`: `Literal[value=/ant-zoom(-big)?-(appear|enter)/]` und `Literal[regex.pattern=/ant-zoom(-big)?-(appear|enter)/]`. Ausnahme: eigener Konfigblock für `e2e/dialog-kern.ts` und `e2e/doku-bilder/**` ohne diese zwei Selektoren (die übrigen Riegel gelten dort weiter).
- [ ] **Step 2: Riegel rot sehen** — `mise exec -- pnpm exec eslint e2e` → Fehler an allen 34 Stellen (Liste aus `grep -rn "ant-zoom-appear" e2e | grep -v doku-bilder` ohne Kommentarzeilen), keiner in `dialog-kern.ts`/`doku-bilder/`.
- [ ] **Step 3: `dialogSteht` erweitern** um `string | RegExp` und `exact` (an `getByRole` durchreichen).
- [ ] **Step 4: Commit** (`test(e2e): Riegel gegen kopierte Zoom-Warte-Zeile (LLH-2067)`); Lint ist danach bis Task 3 rot — darum Task 1–3 vor dem ersten Push abschließen.

### Task 2: Kern-Helfer umstellen

**Files:**
- Modify: `frontend/e2e/einsatz-kern.ts:17-21` (`einsatzDialogOeffnen`)
- Modify: `frontend/e2e/menue-kern.ts:97-103` (`oeffneAbmeldenRueckfrage`)
- Modify: `frontend/e2e/leisten-kern.ts:133-138`

**Interfaces:** Consumes `dialogSteht` aus Task 1. Rückgabewerte der Helfer unverändert (`Locator`).

- [ ] **Step 1:** Je `getByRole('dialog', …)` + `toBeVisible()` + Warte-Zeile → `await dialogSteht(page, '…', { exact: true })` dort, wo vorher `exact: true` stand, sonst ohne.
- [ ] **Step 2:** `mise exec -- pnpm exec eslint e2e/einsatz-kern.ts e2e/menue-kern.ts e2e/leisten-kern.ts` → 0 Fehler.
- [ ] **Step 3: Commit.**

### Task 3: Specs umstellen

**Files (Modify):** `betreuung-pruefliste`, `etb-entwurf-tabs`, `material-liste`, `fahrzeuge-eigene-einheit`, `kraefte-schmal`, `nachforderung-einheit`, `dialoge-handy`, `geraet-bereitstellungsraum`, `nachforderung-material`, `dialogfuss-dichte`, `dialog-rueckfrage`, `trefflaeche-pruefflaechen`, `dokumente`, `material-am-ort`, `unterkunft-kontrast`, `planung-kontrast`, `trefflaeche-optionsknopf`, `gate3-trefflaeche`, `fokus-verdeckung` (alle `frontend/e2e/*.spec.ts`).

**Interfaces:** Consumes `dialogSteht`, `eingeblendet` aus Task 1.

- [ ] **Step 1:** Abbildung nach Design-Doc, „Entscheidungen“:
  - Dialog per Name → `dialogSteht(page|tablet, name)`; vorausgehendes `toBeVisible()` am Dialog entfällt.
  - Dialog per `.filter`/Helfer/`page.getByRole('dialog')` ohne Name (`fahrzeuge-eigene-einheit`, `dokumente:276/476/874`) → `eingeblendet(dialog)`.
  - `geraet-bereitstellungsraum:509` → `eingeblendet(ausruecken)`.
  - `dialog-rueckfrage:41` → `eingeblendet(rueckfrage)`.
  - `etb-entwurf-tabs`: lokale `dialogSteht(page, dialog)` löschen, Aufrufe → `eingeblendet(dialog)`.
  - `betreuung-pruefliste`: lokale Funktion → `bereichSteht(dialog: Locator)`: `await eingeblendet(dialog)` + bestehende `.ant-motion-collapse`-Prüfung; Aufrufe anpassen.
  - Ungenutzte Importe (`Page`) entfernen.
- [ ] **Step 2:** `mise exec -- pnpm lint` und `mise exec -- pnpm typecheck` → beide grün.
- [ ] **Step 3:** `grep -rn "ant-zoom-appear\|ant-zoom-enter" e2e | grep -v doku-bilder` → nur Kommentare und `dialog-kern.ts`.
- [ ] **Step 4: Mutationsprobe Riegel:** alte Zeile in eine Spec einsetzen → `eslint` rot mit der neuen Meldung; zurücknehmen.
- [ ] **Step 5: Commit.**

### Task 4: Regel in `frontend/e2e/AGENTS.md`

**Files:** Modify `frontend/e2e/AGENTS.md` (neuer Punkt nach dem LFH-1114-Punkt; dieser verweist darauf).

- [ ] **Step 1:** Regeltext: in antd-Dialog, Popconfirm oder Popover erst klicken, tippen oder messen, wenn `dialogSteht`/`eingeblendet` (`e2e/dialog-kern.ts`) ihn als stehend meldet; Grund (Klick fällt unter Last in `-appear-active`, LFH-1114/LLH-2065); Riegel `no-restricted-syntax` gegen die Klassennamen, Ausnahmen `dialog-kern.ts`, `doku-bilder/`; Altbestand ohne Wartezeit wird beim Anfassen umgestellt. Herleitung: Design-Doc.
- [ ] **Step 2:** `mise exec -- pnpm exec prettier --check e2e/AGENTS.md` → grün.
- [ ] **Step 3: Commit.**

### Task 5: Prüfen

- [ ] **Step 1:** Geänderte Specs in Chromium: `PW_PROJEKTE=chromium mise exec -- pnpm exec playwright test <geänderte Specs> --trace off` → grün (Debug-Binary vorher per `cargo build`).
- [ ] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e` (Repo-Wurzel) → grün.
