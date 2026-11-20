# Handy-Dialog: nur der Abschluss klebt — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unter `md` klebt im `ErfassungsModal` nur der Abschluss (Primärknopf, Nebenaktionen, Zusammenfassung); „Abbrechen“ steht als Textknopf im Kopf statt des Schließkreuzes; Serienzeile und „Speichern und nächste“ stehen am Formularende.

**Architecture:** Alles in `frontend/src/components/Erfassung.tsx`. Der Kopfknopf ist antds Schließknopf selbst (`closable` als Objekt mit `closeIcon: 'Abbrechen'` und `aria-label`, `styles.close` macht ihn breit): derselbe `onCancel` → `schliessen`, dieselbe Sperre, dieselbe Klasse `.ant-modal-close`, also tragen `kopfBoden` und die bestehenden Kreuz-Messungen weiter. `ErfassungsFormular` teilt unter `md` bei `fussKlebt` den Fuß in einen nicht klebenden Teil (`data-lfh="erfassung-serie"`) und den klebenden Abschluss (`data-lfh="erfassung-fuss"`, ohne „Abbrechen“).

**Tech Stack:** React 19, antd 6.7, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-zpnrt6qz-handy-dialog-fuss-design.md`

## Global Constraints

- Ab `md` und inline (`fussKlebt` aus) bleibt Markup und Verhalten unverändert.
- „Schmal“ heißt `useViewport().istSchmal` (unter `md` = 768 px); kein eigener Medienabfrage-Zugang (`useViewport.guard.test.ts`).
- Der Primärknopf bleibt der einzige `htmlType="submit"`-Knopf im `<form>`.
- Abstände nur aus Token/Raster (`abstandsraster.guard.test.ts`), Knöpfe nebeneinander nur in `Knopfreihe`.
- Bezeichner: Fachwort deutsch, Technik englisch (`AGENTS.md`, LFH-1312); neue Konstante z. B. `abbruchImKopf` (bool).
- Prosa (Kommentare, Tests, Commits) deutsch; Commit-Body mit `Zunder: https://zunder.rubeen.dev/#/aufgabe/zpnrt6qzrs6r1y860x9yus0v`.

## Review Focus

1. Speichern läuft, Nutzer tippt „Abbrechen“ im Kopf → gesperrt, nichts passiert (wie heute das Kreuz). Test in Task 1.
2. Langer Titel im Handschuh (72-px-Knopf) → Titel bricht um, läuft nicht unter „Abbrechen“. Test in Task 3 (e2e, Kästen schneiden sich nicht).
3. Kontakt-Dialog am Einheitengerät: „RTW nötig“ liegt im klebenden Fuß. Test in Task 2 (Nebenaktion im `erfassung-fuss`).
4. Enter im letzten Feld sendet weiter, auch wenn „Speichern und nächste“ jetzt vor dem Primärknopf im DOM steht (nicht `submit`). Test in Task 2.
5. Tab-Lauf am Handy: „Speichern und nächste“ (nicht klebend) wird nicht vom klebenden Fuß verdeckt — bestehende Messung `fussVerdecktKeinFeld` in `e2e/trefflaeche-pruefflaechen.spec.ts` deckt es, solange `erfassung-fuss` nur den klebenden Teil umfasst.

---

### Task 1: Kopfknopf „Abbrechen“ unter `md`

**Files:**
- Modify: `frontend/src/components/Erfassung.tsx` (`ErfassungsModal`)
- Test: `frontend/src/components/Erfassung.test.tsx` (`describe('ErfassungsModal')`)

**Interfaces:**
- Produces: im Modal unter `md` ein Knopf mit zugänglichem Namen „Abbrechen“ und Klasse `ant-modal-close`; kein Knopf „Close“.

- [ ] **Step 1: Failing tests** in `describe('ErfassungsModal')`, je mit `setzeViewportBreite(390)`:
  - `'zeigt am Handy statt des Kreuzes „Abbrechen“ im Kopf (LLH-1763)'`: `getByRole('button', { name: 'Abbrechen' })` hat Klasse `ant-modal-close` und steht in `.ant-modal-container` außerhalb des `<form>` (`closest('form') === null`); `queryByRole('button', { name: /Close/ })` ist `null`; genau ein Knopf „Abbrechen“ im Dialog.
  - `'„Abbrechen“ im Kopf leert die Felder und ruft onAbbrechen einmal'`: tippen „Brücke“, Klick → `onAbbrechen` 1×, Feld `''`.
  - `'„Abbrechen“ im Kopf ist gesperrt, solange gespeichert wird'`: `ModalHarness` mit `speicherung={{ isPending: true, error: null, reset }}` (Harness um Prop erweitern) → Knopf `toBeDisabled()`.
  - Gegenprobe ohne `setzeViewportBreite`: Knopf „Close“ vorhanden, kein „Abbrechen“ in `.ant-modal-close`.
- [ ] **Step 2:** `mise exec -- pnpm vitest run src/components/Erfassung.test.tsx` → neue Tests FAIL.
- [ ] **Step 3:** In `ErfassungsModal`: `const { istSchmal } = useViewport();` `closable` unter `istSchmal` = `{ closeIcon: 'Abbrechen', 'aria-label': 'Abbrechen', disabled: sperrtAbbruch }`, sonst wie heute. `styles.close` unter `istSchmal`: `width: 'auto'`, `paddingInline: token.paddingSM`, Schrift `token.fontSize`, normales Gewicht, Farbe `token.colorText`, Rand `1px solid token.colorBorder` (sichtbar als Knopf). `styles.header` unter `istSchmal` zusätzlich `paddingInlineEnd` so, dass der Titel vor dem Knopf umbricht (`calc(10ch + 2 * paddingSM + Abstand des Knopfs zum Rand)`; Wert im Kommentar begründen). `kopfBoden` bleibt.
- [ ] **Step 4:** Tests PASS (ganze Datei).
- [ ] **Step 5: Commit** `feat: Handy-Dialog trägt „Abbrechen“ im Kopf statt des Kreuzes (LLH-1763)`.

### Task 2: Fuß teilen — nur der Abschluss klebt

**Files:**
- Modify: `frontend/src/components/Erfassung.tsx` (`ErfassungsFormular`, Dateikopf)
- Test: `frontend/src/components/Erfassung.test.tsx`

**Interfaces:**
- Consumes: Task 1 (Abbrechen im Kopf), damit der Dialog einen Ausweg behält.
- Produces: unter `md` mit `fussKlebt`: `[data-lfh="erfassung-serie"]` (nicht klebend, enthält Einstellungszeile und „Speichern und nächste“, nur bei `serie`), `[data-lfh="erfassung-fuss"]` (klebend, enthält `erfassung-aktion` mit Zusammenfassung, Nebenaktionen, Primär; kein „Abbrechen“).

- [ ] **Step 1: Failing tests** (neues `describe('ErfassungsModal — Fuß am Handy (LLH-1763)')`, `setzeViewportBreite(390)`, Modal-Harness mit `serie`, `uebernahme={['ort']}`, optional `nebenaktionen`, `zusammenfassung`):
  - `'klebt nur den Abschluss: Primärknopf im Fuß, kein Abbrechen, keine Serie'`: `erfassung-fuss` enthält „Erfassen“, enthält weder „Abbrechen“ noch „Speichern und nächste“ noch „Werte behalten“; `style.position === 'sticky'`.
  - `'Serienzeile und „Speichern und nächste“ stehen am Formularende, nicht klebend'`: `erfassung-serie` enthält beide, `style.position !== 'sticky'`, liegt im DOM vor `erfassung-fuss` und im `<form>`.
  - `'Nebenaktionen kleben mit dem Primärknopf'`: mit `nebenaktionen=[{ schluessel: 'rtw', text: 'RTW nötig', danger: true }]` → „RTW nötig“ in `erfassung-fuss`, vor „Erfassen“.
  - `'Zusammenfassung bleibt am Primärknopf'`: Zusammenfassungstext in `erfassung-fuss`.
  - `'Enter im Feld sendet weiter über den Primärknopf'`: `{Enter}` im Feld „Ort“ → `onErfassen` 1×, Dialog bleibt nicht im Serienmodus (`onFertig` 1×).
  - Bestehender Test `'stapelt die Knöpfe auf dem Handschirm …'` (inline, `Harness`) bleibt grün: inline unverändert.
- [ ] **Step 2:** Tests FAIL.
- [ ] **Step 3:** In `ErfassungsFormular`: `const abbruchImKopf = fussKlebt && istSchmal;` Einstellungszeile und Serienknopf als lokale Elemente; bei `abbruchImKopf` vor dem klebenden Fuß ein `div data-lfh="erfassung-serie"` (Rand oben `token.margin`, `Stapel`/Abstand aus Raster, Serienknopf in `Knopfreihe fuss`), im klebenden Fuß nur `erfassung-aktion` ohne „Abbrechen“ und ohne Serienknopf. Sonst Markup wie heute. Dateikopf („DER FUSS HAT ZWEI ZEILEN“, „Unter `md` …“, „Im Dialog klebt der Fuß …“) auf die neue Regel umschreiben.
- [ ] **Step 4:** `mise exec -- pnpm vitest run src/components/` PASS.
- [ ] **Step 5: Commit** `feat: Handy-Dialog klebt nur den Abschluss, Serie am Formularende (LLH-1763)`.

### Task 3: e2e und Regeln nachziehen

**Files:**
- Modify: `frontend/e2e/dialoge-handy.spec.ts` (`pruefSerienfuss`, Dateikopf)
- Modify: `frontend/AGENTS.md` („Knopfreihen über `Knopfreihe`“, Erfassungs-Norm)
- Prüfen: `frontend/e2e/trefflaeche-pruefflaechen.spec.ts` (`fussVerdecktKeinFeld`, Kreuz-Messung um Z. 1556), `frontend/e2e/fokus-verdeckung.spec.ts` (`.ant-modal-close[data-e2e-fokus]`), `frontend/e2e/betreuung-pruefliste.spec.ts` — tragen weiter, weil der Kopfknopf `.ant-modal-close` bleibt; nur Kommentare „Schließkreuz“ anpassen, wo sie am Handy messen.

- [ ] **Step 1:** `pruefSerienfuss` erweitern: „Abbrechen“ liegt in `.ant-modal-close` (Kopf), „Speichern und nächste“ nicht in `[data-lfh="erfassung-fuss"]`; Höhe von `erfassung-fuss` < 20 % der Schirmhöhe (700 px → < 140 px), Messwert als Annotation; Titelkasten und Kopfknopf-Kasten schneiden sich nicht. Testtitel nennt LLH-1763.
- [ ] **Step 2:** `frontend/AGENTS.md`: in „Knopfreihen über `Knopfreihe`“ und in der Erfassungs-Norm je ein Satz: unter `md` trägt das `ErfassungsModal` „Abbrechen“ als Kopfknopf statt des Kreuzes, klebend nur der Abschluss (Primär, Nebenaktionen, Zusammenfassung), Serie am Formularende (LLH-1763).
- [ ] **Step 3:** Design-System-Wächter: `mise exec -- pnpm vitest run scripts/design-system src/components/designSystem.guard.test.ts` (Pfad per `rg -l designSystem.guard`); rot → `mise exec -- pnpm -C frontend design-system`, Erzeugtes mitcommitten.
- [ ] **Step 4:** e2e lokal, wenn das Backend baut: `cargo build` im Wurzelverzeichnis, dann in `frontend/` `mise exec -- pnpm exec playwright test e2e/dialoge-handy.spec.ts --trace off -g "Serienmaske"` → PASS. Sonst im PR vermerken.
- [ ] **Step 5:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [ ] **Step 6: Commit** `test: Handy-Serienfuß misst den klebenden Abschluss; Regel nachgezogen (LLH-1763)`.
