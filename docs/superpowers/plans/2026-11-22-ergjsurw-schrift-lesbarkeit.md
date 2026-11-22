# Schrift und Lesbarkeit (LLH-1956) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die vier Lesbarkeitsteile aus dem Entwurf umsetzen, je Teil ein PR mit voller e2e-Suite.
Dieser Plan wächst je Teil: ein Abschnitt entsteht zu Beginn seines Branches (Entwurf, „Reihenfolge
und Schnitt“). Bisher: **Teil 1, LLH-2043 Zoom frei**.

**Architecture:** Frontend-only. Werte kommen aus `theme/tokens.ts` und werden in `theme/rollen.css`
gespiegelt (`rollen.guard.test.ts` hält beide gleich). Regeln stehen in `frontend/AGENTS.md`, das
Design System wird daraus neu erzeugt.

**Tech Stack:** React 19, antd 5, Vite, Vitest (Wächter), Playwright (e2e, Projekt `chromium`).

**Spec:** `docs/superpowers/specs/2026-11-22-ergjsurw-schrift-lesbarkeit-design.md`

## Global Constraints

- Keine Kopplung der Schrift an die Dichte (ADR-0071 bleibt).
- Keine neue Zeile in `theme/schriftgroesse.schuld.ts`, keine wachsende Schuld.
- Prosa, Kommentare, Testnamen deutsch; neue Bezeichner: Fachbegriff deutsch, Technik englisch
  (`AGENTS.md`, Bezeichner-Sprache).
- Node/pnpm nur über `mise exec -- …`; Gate vor dem PR `./scripts/check-all.sh --geaendert --ohne-e2e`.
- PR gegen `alpha` mit Label `voll`; Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/<id>` je
  (Unter-)Aufgabe in Commit-Body und PR.

## Review Focus

1. Ein Feld mit eigener Inline-Schriftgröße (Code-Feld `instanz/InstanzkopplungSeite.tsx`,
   `monoStil('monoGross')`) zoomt auf dem iPhone trotzdem → Task 2 prüft Inline-Größe im e2e.
2. Desktop (feiner Zeiger) bekommt die 16 px versehentlich mit → Task 2, Gegenfall ohne Touch.
3. Antds Select zeigt den gewählten Wert in einem `span`, getippt wird in einem `input`: beim Tippen
   springt die Schrift von 15 auf 16 → Task 2 setzt beide gleich und misst beide.
4. Kontrollkästchen, Radio und Schieber bekommen eine Schriftgröße, die ihr Maß verschiebt → die
   Regel schließt `type=checkbox|radio|range|color|file` aus (Task 2).
5. In `komfortabel` (48 px) wird ein 16-px-Feld höher als die Steuerhöhe → Task 2 misst die Höhe
   eines Eingabefelds auf Touch in `komfortabel` gegen 48 ± 1.

---

## Teil 1 — LLH-2043 Zoom frei

Zunder: https://zunder.rubeen.dev/#/aufgabe/qy62952x1hckdlfqz5scij6n

### Task 1: Viewport frei, Wächter `zoomFrei`

**Files:**
- Modify: `frontend/index.html:8-14` (Kommentar und `<meta name="viewport">`)
- Modify: `frontend/src/index.css:9-18` (nur Kommentar; `touch-action`/`text-size-adjust` bleiben)
- Delete: `frontend/src/theme/keinZoom.guard.test.ts`
- Create: `frontend/src/theme/zoomFrei.guard.test.ts`

**Interfaces:** keine.

- [ ] **Step 1: Wächter schreiben** — `zoomFrei.guard.test.ts`, `describe('Zoom frei (LLH-2043)')`:
  - `it('der Viewport sperrt den Zoom nicht')`: Inhalt des Viewport-`meta` (Regex wie im alten
    Wächter) enthält `width=device-width` und `initial-scale=1.0`, enthält **kein** Teil, das mit
    `maximum-scale` oder `user-scalable` beginnt.
  - `it('das Dokument sperrt nur den Doppeltipp-Zoom')`: `html { … }` in `index.css` trägt weiter
    `touch-action: manipulation;` und `text-size-adjust: 100%;` (wie im alten Wächter).
  - Alten Wächter `keinZoom.guard.test.ts` löschen.
- [ ] **Step 2: rot sehen** — `mise exec -- pnpm -C frontend exec vitest run src/theme/zoomFrei.guard.test.ts`
  → FAIL im ersten Fall (`maximum-scale` gefunden).
- [ ] **Step 3: Viewport** auf `content="width=device-width, initial-scale=1.0"`; Kommentar über
  dem `meta` und in `index.css` sagen: Zoom frei (LLH-2043, umgekehrt 22.11.2026 gegenüber LLH-1328),
  den iOS-Fokus-Zoom verhindert die Touch-Feldschrift (`rollen.css`), `manipulation` sperrt nur den
  Doppeltipp.
- [ ] **Step 4: grün sehen** — derselbe Lauf → PASS.
- [ ] **Step 5: Commit** `feat(frontend): Zoom frei, Viewport ohne Sperre (LLH-2043)`.

### Task 2: Eingabefelder 16 px auf Touch

**Files:**
- Modify: `frontend/src/theme/tokens.ts` (neben `schriftskala`)
- Modify: `frontend/src/theme/rollen.css` (`:root`-Variable und Regel am Dateiende)
- Modify: `frontend/src/theme/rollen.guard.test.ts`
- Create: `frontend/e2e/zoom-frei.spec.ts`

**Interfaces:**
- Produces: `export const feldSchriftTouch = 16;` in `theme/tokens.ts` (px, mit Doku-Kommentar:
  iOS zoomt beim Fokus in ein Feld unter 16 px, gilt nur auf grobem Zeiger, nicht Teil der
  `schriftskala`); CSS-Variable `--lfh-feld-schrift-touch: 16px` in `:root` von `rollen.css`.

- [ ] **Step 1: Unit-Wächter** in `rollen.guard.test.ts`, neuer `describe('Touch-Feldschrift (LLH-2043)')`:
  - `it('CSS und TS tragen denselben Wert')`: `hell['--lfh-feld-schrift-touch']` ===
    `` `${feldSchriftTouch}px` ``; `feldSchriftTouch` === 16 (Literal-Pin, iOS-Schwelle).
  - `it('die Regel greift nur auf grobem Zeiger und liest die Variable')`: der CSS-Quelltext
    enthält einen Block `@media (pointer: coarse)` mit `font-size: var(--lfh-feld-schrift-touch) !important`;
    kein `font-size: 16px` irgendwo in `rollen.css`.
  - Die Variable steht nicht in den `data-dichte`-Blöcken (sie hängt am Zeiger, nicht an der Dichte).
- [ ] **Step 2: rot sehen** — `mise exec -- pnpm -C frontend exec vitest run src/theme/rollen.guard.test.ts` → FAIL.
- [ ] **Step 3: umsetzen.** Token und `:root`-Variable wie oben. Regel am Ende von `rollen.css`:

```css
@media (pointer: coarse) {
  input:not([type='checkbox'], [type='radio'], [type='range'], [type='color'], [type='file']),
  textarea,
  select,
  .ant-select-selection-item,
  .ant-select-selection-placeholder {
    font-size: var(--lfh-feld-schrift-touch) !important;
  }
}
```

  `!important`, damit auch Inline-Größen (`style={monoStil(…)}`) weichen (Entwurf, Teil 1).
- [ ] **Step 4: grün sehen** — derselbe Lauf → PASS; danach `vitest run src/theme` ganz → PASS.
- [ ] **Step 5: e2e** `zoom-frei.spec.ts` (Muster `dichte-ableitung.spec.ts`, Seite `/login`, die
  Anmeldefelder sind antd-`Input`/`Input.Password`):
  - `test.describe('Touch 390 × 844')` mit `test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })`:
    - Vorbedingung `matchMedia('(pointer: coarse)').matches === true`, `html[data-dichte=komfortabel]`.
    - `'Viewport lässt den Zoom zu'`: `meta[name=viewport]` `content` ohne `maximum-scale`/`user-scalable`.
    - `'Eingabefelder tragen 16 px, der Knopf nicht'`: berechnete `font-size` des Benutzername-
      und Passwortfelds = `16px`; des Knopfs „Anmelden“ ≠ `16px` (bleibt Dichte-Grundschrift 15).
    - `'Feldhöhe bleibt die Steuerhöhe'`: Höhe des Benutzernamen-Felds (Wrapper `.ant-input-affix-wrapper`
      bzw. `.ant-input`) ≤ 49 px.
    - `'auch Inline-Größen weichen'`: nach dem Anmelden als Admin die Instanzkopplungsseite öffnen
      (Weg aus `e2e/` übernehmen, falls eine Spec sie schon besucht; sonst per Route) und die
      Code-Eingabe messen: `16px`. Ist die Seite ohne Fixture nicht erreichbar, stattdessen per
      `page.evaluate` ein `<input style="font-size:14px">` in `body` einsetzen und messen.
  - `test.describe('Desktop, feiner Zeiger')`: `'Eingabefelder bleiben in der Dichte-Grundschrift'`:
    Benutzername-Feld ≠ `16px` (13,5 px in `kompakt`).
- [ ] **Step 6: e2e laufen** — `cd frontend && mise exec -- pnpm exec playwright test e2e/zoom-frei.spec.ts --trace off` → PASS
  (vorher `cargo build` in der Wurzel, falls die Konfiguration das Binary startet).
- [ ] **Step 7: Commit** `feat(frontend): Eingabefelder auf Touch in 16 px, kein Fokus-Zoom (LLH-2043)`.

### Task 3: Regel, Design System, Gate, PR

**Files:**
- Modify: `frontend/AGENTS.md` (Bedien-Leitlinie, Punkt „Kein Zoom wie in einer App“)
- Generated: `docs/design/design-system/**` über `mise exec -- pnpm -C frontend design-system`

- [ ] **Step 1: Regel ersetzen** durch „**Zoom frei, Felder 16 px auf Touch** (LLH-2043, umgekehrt
  22.11.2026 gegenüber LLH-1328 „Kein Zoom wie in einer App“): der Viewport in `index.html` sperrt
  nicht; `touch-action: manipulation` in `index.css` sperrt nur den Doppeltipp. Damit iOS beim Fokus
  nicht zoomt, tragen Eingabefelder auf grobem Zeiger `feldSchriftTouch` (16 px, `theme/tokens.ts`,
  Regel in `rollen.css`), auch gegen Inline-Größen. Wächter `theme/zoomFrei.guard.test.ts`, Beleg
  `e2e/zoom-frei.spec.ts`.“ Der Satz „kein Feld wird dafür auf 16 px gehoben“ fällt.
- [ ] **Step 2: Design System neu erzeugen**, Diff zeigt nur den Regelwechsel.
- [ ] **Step 3: Gate** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [ ] **Step 4: Risiko-Specs lokal** (Touch-Felder werden größer): `dichte-ableitung`, `dichte`,
  `betroffene-handy`, `dialoge-handy`, `command-palette`, `verpflegung-empfaenger`,
  `leisten-flaeche` → grün oder Ursache klären (Platz schaffen, nicht abschwächen).
- [ ] **Step 5: Bilder** — Anmeldeseite 390 px Touch vorher/nachher (Wegwerf-Spec unter
  `e2e/doku-bilder/zz-qy62952x.bilder.ts`, nicht committen) und in PR und Meldung.
- [ ] **Step 6: Commit, Push, PR** gegen `alpha`, Label `voll`, mit Design-Doc, Plan und Teil 1.
