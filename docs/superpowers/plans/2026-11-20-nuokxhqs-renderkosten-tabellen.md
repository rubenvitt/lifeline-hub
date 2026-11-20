# Renderkosten der Tabellen beim Öffnen — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Personal und Betroffene blockieren beim Öffnen den Hauptthread höchstens ~100 ms am Stück.

**Architecture:** Drei Hebel im Frontend. Overlays in Zeilen hängen sich erst beim ersten Öffnen
ein (`useErstBeiBedarf`), `setzeKopfFreiraum` misst vor dem Schreiben, und die `Datensicht`
rendert beim ersten Anzeigen stückweise (`useStueckweise`). Dazu eine Regel in `frontend/AGENTS.md`.

**Tech Stack:** React 19, antd 6 (`@rc-component/trigger`), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-19-nuokxhqs-renderkosten-tabellen-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/nuokxhqs4uym2tyer8n6oemd (LLH-1974)

## Global Constraints

- Pfade relativ zu `frontend/`. Kommandos in `frontend/` mit `mise exec -- …`.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, LFH-1312). Kommentare und
  Testnamen deutsch.
- Kein Bedienweg ändert sich: Fokus nach dem Schließen am Auslöser, Deeplink trifft seine Zeile,
  der Druck zeigt alle Zeilen, die Virtualisierung ab 201 Zeilen (`DATENSICHT_SCHWELLE`) bleibt.
- `STUECK_ZEILEN = 4`.
- Stückweise nur beim ersten Anzeigen. Spätere Änderungen (Filter, Sortierung, Live-Daten)
  rendern sofort vollständig.

## Review Focus

1. Erstes Öffnen per **Tastatur** (Enter/Space am Auslöser): das Overlay öffnet in einem Zug, und
   beim Schließen mit Escape liegt der Fokus am neu eingehängten Knopf. Tests in Task 2 und 3.
2. Die **Palette bzw. Tastaturebene** öffnet die Statuswahl, bevor je geklickt wurde (`oeffne`).
   Der bestehende Test `StatusWahl.palette.test.tsx` muss grün bleiben (Task 3).
3. Ein **Deeplink** (`HERVORGEHOBEN`) auf eine Zeile hinter dem ersten Stück: die Zeile steht im
   ersten Commit (Task 6).
4. **Druck** während des Stückelns: `druckt` rendert alles sofort (Task 6).
5. Die Liste **schrumpft** während des Stückelns (Filter): kein Absturz, keine leere Liste (Task 6).

---

### Task 1: Hook `useErstBeiBedarf`

**Files:**
- Create: `src/components/useErstBeiBedarf.ts`
- Test: `src/components/useErstBeiBedarf.test.tsx`

**Interfaces:**
- Produces: `export function useErstBeiBedarf(offen: boolean): boolean`. Liefert `true`, sobald
  `offen` einmal `true` war, und bleibt dabei. Gesetzt im Render (Zustand beim Rendern angepasst),
  nicht per Effekt, damit der aufrufende Render das Overlay schon mit `open` einhängt.

- [ ] **Step 1: Failing test** — `renderHook` mit Prop `offen`:
  - `'false am Anfang'`: `offen=false` → `false`.
  - `'wird im selben Render wahr, in dem offen wahr wird'`: rerender mit `true` → `true`.
  - `'bleibt wahr, wenn offen wieder falsch wird'`: danach `false` → `true`.
- [ ] **Step 2:** `mise exec -- pnpm vitest run src/components/useErstBeiBedarf.test.tsx`. Erwartet: FAIL (Modul fehlt).
- [ ] **Step 3:** Hook implementieren, Dateikopf nennt LLH-1974 und die Regel aus Task 6.
- [ ] **Step 4:** Test erneut, Erwartet: PASS.
- [ ] **Step 5:** Commit `perf: Hook für Overlays erst bei Bedarf (LLH-1974)`.

### Task 2: `InlineAngabe` hängt das Popover erst beim ersten Öffnen ein

**Files:**
- Modify: `src/components/InlineAngabe.tsx` (`mitPopover`, ~Zeile 775)
- Test: `src/components/InlineAngabe.test.tsx` (Block „schwebend in Tabellenzellen (LLH-1795)“)

**Interfaces:**
- Consumes: `useErstBeiBedarf(bearbeitet)` aus Task 1.

- [ ] **Step 1: Failing test** im schwebenden Block, mit `vi.mock('antd', …)`, das `Popover` als
  `vi.fn` um das echte legt (eigene Testdatei `InlineAngabe.bedarf.test.tsx`, damit der Mock die
  übrigen Tests nicht berührt):
  - `'hängt geschlossen kein Popover ein (LLH-1974)'`: nach dem Render ist der Popover-Spy nie aufgerufen, `[data-lfh="angabe-anker"]` steht.
  - `'öffnet beim ersten Klick in einem Zug'`: Klick auf „… bearbeiten“ → Formularfeld sichtbar und fokussiert.
  - `'öffnet beim ersten Enter in einem Zug und gibt den Fokus nach Escape an den Knopf zurück'`: Knopf fokussieren, `{Enter}`, Feld fokussiert; `{Escape}` → `document.activeElement` ist der Knopf mit Namen „… bearbeiten“.
- [ ] **Step 2:** Lauf der neuen Datei, Erwartet: FAIL beim ersten Test.
- [ ] **Step 3:** In `mitPopover` schwebend bis zum ersten Öffnen nur den Anker-`span` (gleiche
  Attribute und `anchorRef`) rendern, danach wie heute `Popover` um denselben Anker. Den Anker als
  lokale Funktion bauen, damit beide Zweige dasselbe Markup tragen. Kommentar mit Grund (zweiter
  synchroner Render je Zeile).
- [ ] **Step 4:** `mise exec -- pnpm vitest run src/components/InlineAngabe` (alle Dateien). Erwartet: PASS.
- [ ] **Step 5:** Commit `perf: InlineAngabe hängt das Popover erst beim Öffnen ein (LLH-1974)`.

### Task 3: `StatusWahl` hängt das Dropdown erst beim ersten Öffnen ein

**Files:**
- Modify: `src/components/StatusWahl.tsx` (Rückgabe ab `<Dropdown`, ~Zeile 286)
- Test: `src/components/StatusWahl.bedarf.test.tsx` (neu, mit `Dropdown`-Spy wie Task 2)

**Interfaces:**
- Consumes: `useErstBeiBedarf(offen)` aus Task 1.

- [ ] **Step 1: Failing test:**
  - `'hängt geschlossen kein Dropdown ein (LLH-1974)'`: Spy nie aufgerufen, Knopf „Status von … ändern“ steht.
  - `'öffnet beim ersten Klick das Menü'`: Klick → genau ein offenes `[role="menu"]` (Muster `oeffneMenue` aus `StatusWahl.test.tsx`).
  - `'öffnet per Enter und gibt den Fokus nach Escape an den Knopf zurück'`.
- [ ] **Step 2:** Lauf, Erwartet: FAIL beim ersten Test.
- [ ] **Step 3:** Bis zum ersten Öffnen nur den `StatusKnopf` (gleiche Props, `ref={verbindeKnopf}`)
  mit `onClick={() => setzeOffen(true)}` rendern; danach den `Dropdown` wie heute um denselben
  Knopf (ohne eigenes `onClick`). `useTastaturEbene`/`oeffne` unverändert.
- [ ] **Step 4:** `mise exec -- pnpm vitest run src/components/StatusWahl`. Erwartet: PASS, auch `StatusWahl.palette.test.tsx`.
- [ ] **Step 5:** Commit `perf: StatusWahl hängt das Menü erst beim Öffnen ein (LLH-1974)`.

### Task 4: Tooltip in `EinsatzfunktionZelle` erst bei Bedarf

**Files:**
- Modify: `src/kraefte/EinsatzfunktionZelle.tsx` (`Tooltip` „Funktion eintragen“, ~Zeile 108)
- Test: `src/kraefte/EinsatzfunktionZelle.test.tsx`

**Interfaces:**
- Consumes: `useErstBeiBedarf` aus Task 1, Argument: `gezeigt` (lokaler Zustand, `true` bei
  `onPointerEnter` oder `onFocus` des Knopfs).

- [ ] **Step 1: Failing test** (Fall `leerMitQualifikation`, Muster der vorhandenen Tests):
  - `'zeigt den Tooltip beim ersten Überfahren'`: `userEvent.hover` auf „Funktion zu … eintragen“ → `findByRole('tooltip')` mit „Funktion eintragen“.
  - `'behält den Fokus, wenn der Tooltip beim ersten Fokus eingehängt wird'`: `userEvent.tab()` bis zum Knopf → nach dem Einhängen ist `document.activeElement` der Knopf mit diesem Namen, der Tooltip steht.
  - `'hängt vor dem ersten Überfahren keinen Tooltip ein'`: `Tooltip`-Spy über `vi.mock('antd', …)` (eigene Datei `EinsatzfunktionZelle.bedarf.test.tsx`) nie aufgerufen.
- [ ] **Step 2:** Lauf, Erwartet: FAIL beim dritten Test.
- [ ] **Step 3:** Vor dem ersten `pointerenter`/`focus` den `Button` ohne `Tooltip` rendern; danach
  `Tooltip` mit `defaultOpen` um den Knopf. Hatte der alte Knopf den Fokus, im Layout-Effekt nach
  dem Einhängen den neuen fokussieren (`ref` aus `ausloeser` weiterreichen).
- [ ] **Step 4:** `mise exec -- pnpm vitest run src/kraefte/EinsatzfunktionZelle.test.tsx`. Erwartet: PASS.
- [ ] **Step 5:** Commit `perf: Tooltip der Einsatzfunktion erst bei Bedarf (LLH-1974)`.

### Task 5: `setzeKopfFreiraum` misst vor dem Schreiben

**Files:**
- Modify: `src/components/KatalogTabelle.tsx` (`setzeKopfFreiraum`, ~Zeile 548)
- Test: `src/components/KatalogTabelle.test.tsx` (neben den bestehenden Freiraum-Tests, ~Zeile 1077)

- [ ] **Step 1: Failing test:**
  - `'liest alle drei Maße, bevor es schreibt (LLH-1974)'`: Kopf, Kennung und Aktion mit Gettern für `offsetHeight`/`offsetWidth`, die in ein Protokoll schreiben; `wurzel.style.setProperty` gespyt, ebenfalls ins Protokoll. Erwartet: drei `lies:*` vor dem ersten `schreib:*`.
  - `'schreibt nichts, wenn sich kein Maß geändert hat'`: zweiter Aufruf mit gleichen Maßen → `setProperty` nicht erneut aufgerufen.
- [ ] **Step 2:** `mise exec -- pnpm vitest run src/components/KatalogTabelle.test.tsx -t "Maße|kein Maß"`. Erwartet: FAIL.
- [ ] **Step 3:** Erst die drei Elemente suchen und messen, dann je Variable nur schreiben, wenn
  `getPropertyValue(name) !== wert`. Kommentar: jede Messung nach einem Schreiben erzwingt eine volle
  Style-Neuberechnung.
- [ ] **Step 4:** `mise exec -- pnpm vitest run src/components/KatalogTabelle.test.tsx`. Erwartet: PASS, auch die drei alten Freiraum-Tests.
- [ ] **Step 5:** Commit `perf: Kopf-Freiraum misst vor dem Schreiben (LLH-1974)`.

### Task 6: Stückweises Rendern der `Datensicht` und Regel

**Files:**
- Create: `src/components/stueckweise.ts`
- Modify: `src/components/Datensicht.tsx` (`tabellenZeilen` ~Zeile 2384, ungruppierte `kartenListe(sichtbareZeilen)` ~Zeile 2833)
- Modify: `src/test/setup.ts` (Stückeln aus)
- Modify: `frontend/AGENTS.md` (Bedien-Leitlinie), Dateiköpfe von `InlineAngabe.tsx`, `StatusWahl.tsx`, `Datensicht.tsx`
- Test: `src/components/stueckweise.test.tsx`, `src/components/Datensicht.stueckweise.test.tsx`

**Interfaces:**
- Produces in `stueckweise.ts`:
  - `export const STUECK_ZEILEN = 4;`
  - `export function setzeStueckweise(an: boolean): void` (Modulschalter, Vorgabe `true`; `setup.ts` ruft `setzeStueckweise(false)` in `beforeEach`)
  - `export function useStueckweise(anzahl: number, aktiv: boolean): number` → wie viele Zeilen zu rendern sind. Beim ersten Render mit `aktiv && schalter && anzahl > STUECK_ZEILEN` liefert er `STUECK_ZEILEN` und erhöht per `setTimeout(…, 0)` je Schritt um `STUECK_ZEILEN`, bis `anzahl` erreicht ist. Danach, und wenn er nie aktiv war, liefert er `anzahl`. Ist `aktiv` irgendwann `false`, ist das Stückeln für diese Instanz beendet (liefert `anzahl`).
- Consumes in `Datensicht`: `aktiv = !virtuell && !druckt && !hatHervorgehobene` (eine Zeile trägt `HERVORGEHOBEN` in `zeilenKlasse`).

- [ ] **Step 1: Failing tests** `stueckweise.test.tsx` (fake timers, Schalter an):
  - `'liefert zuerst STUECK_ZEILEN, dann schrittweise alle'`: `anzahl=10` → 4, nach einem Timer 8, nach dem nächsten 10.
  - `'stückelt nicht, wenn die Liste klein genug ist'`: `anzahl=4` → 4 ohne Timer.
  - `'stückelt nicht, wenn der Schalter aus ist'`.
  - `'rendert alles, sobald aktiv falsch wird'`: mitten im Stückeln `aktiv=false` → `anzahl`.
  - `'bleibt bei einer schrumpfenden Liste nie über anzahl'`: 10 → nach erstem Schritt `anzahl=3` → 3.
- [ ] **Step 2: Failing tests** `Datensicht.stueckweise.test.tsx` (Schalter an, 10 Zeilen, Muster aus `Datensicht.virtuell.test.tsx`):
  - `'rendert beim ersten Anzeigen 4 Zeilen und dann alle'`
  - `'rendert sofort alle, wenn eine Zeile hervorgehoben ist'` (Deeplink)
  - `'rendert im Druck sofort alle'`
  - `'zeigt nach einer späteren Änderung sofort alle Zeilen'` (nach Abschluss Daten tauschen → alle neuen Zeilen im selben Render)
  - `'Zähler zählt alle Zeilen, auch während des Stückelns'`
- [ ] **Step 3:** Läufe, Erwartet: FAIL (Modul fehlt).
- [ ] **Step 4:** `stueckweise.ts` implementieren, in `Datensicht` `tabellenZeilen` und die ungruppierte
  Kartenliste auf `sichtbareZeilen.slice(0, bis)` setzen, `setup.ts` ergänzen.
- [ ] **Step 5:** `mise exec -- pnpm vitest run src/components` . Erwartet: PASS.
- [ ] **Step 6:** Regel unter „Bedien-Leitlinie“ in `frontend/AGENTS.md` (Wortlaut aus der Spec,
  Abschnitt 4), Dateiköpfe nennen sie; `mise exec -- pnpm exec prettier --write AGENTS.md`.
- [ ] **Step 7:** Commit `perf: Datensicht rendert beim Öffnen stückweise, Regel für Overlays (LLH-1974)`.

### Task 7: Messen und Gates

- [ ] **Step 1:** Produktions-Build (`mise exec -- node node_modules/vite/bin/vite.js build`) und
  Messung mit dem Aufbau der Spec (Personal, Betroffene, Fahrzeuge, je 4 Runden). Ergebnis als
  Kommentar an LLH-1974 und in den PR unter „Geprüft“. Ziel: ≤ ~100 ms längste Blockade.
- [ ] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e` im Repo-Wurzelverzeichnis. Erwartet: grün.
- [ ] **Step 3:** Bilder: keine sichtbare Änderung im Endzustand. Der PR sagt das in einem Satz.
