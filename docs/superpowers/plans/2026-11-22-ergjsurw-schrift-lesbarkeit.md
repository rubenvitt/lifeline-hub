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

- [x] **Step 1: Wächter schreiben** — `zoomFrei.guard.test.ts`, `describe('Zoom frei (LLH-2043)')`:
  - `it('der Viewport sperrt den Zoom nicht')`: Inhalt des Viewport-`meta` (Regex wie im alten
    Wächter) enthält `width=device-width` und `initial-scale=1.0`, enthält **kein** Teil, das mit
    `maximum-scale` oder `user-scalable` beginnt.
  - `it('das Dokument sperrt nur den Doppeltipp-Zoom')`: `html { … }` in `index.css` trägt weiter
    `touch-action: manipulation;` und `text-size-adjust: 100%;` (wie im alten Wächter).
  - Alten Wächter `keinZoom.guard.test.ts` löschen.
- [x] **Step 2: rot sehen** — `mise exec -- pnpm -C frontend exec vitest run src/theme/zoomFrei.guard.test.ts`
  → FAIL im ersten Fall (`maximum-scale` gefunden).
- [x] **Step 3: Viewport** auf `content="width=device-width, initial-scale=1.0"`; Kommentar über
  dem `meta` und in `index.css` sagen: Zoom frei (LLH-2043, umgekehrt 22.11.2026 gegenüber LLH-1328),
  den iOS-Fokus-Zoom verhindert die Touch-Feldschrift (`rollen.css`), `manipulation` sperrt nur den
  Doppeltipp.
- [x] **Step 4: grün sehen** — derselbe Lauf → PASS.
- [x] **Step 5: Commit** `feat(frontend): Zoom frei, Viewport ohne Sperre (LLH-2043)`.

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

- [x] **Step 1: Unit-Wächter** in `rollen.guard.test.ts`, neuer `describe('Touch-Feldschrift (LLH-2043)')`:
  - `it('CSS und TS tragen denselben Wert')`: `hell['--lfh-feld-schrift-touch']` ===
    `` `${feldSchriftTouch}px` ``; `feldSchriftTouch` === 16 (Literal-Pin, iOS-Schwelle).
  - `it('die Regel greift nur auf grobem Zeiger und liest die Variable')`: der CSS-Quelltext
    enthält einen Block `@media (pointer: coarse)` mit `font-size: var(--lfh-feld-schrift-touch) !important`;
    kein `font-size: 16px` irgendwo in `rollen.css`.
  - Die Variable steht nicht in den `data-dichte`-Blöcken (sie hängt am Zeiger, nicht an der Dichte).
- [x] **Step 2: rot sehen** — `mise exec -- pnpm -C frontend exec vitest run src/theme/rollen.guard.test.ts` → FAIL.
- [x] **Step 3: umsetzen.** Token und `:root`-Variable wie oben. Regel am Ende von `rollen.css`:

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
- [x] **Step 4: grün sehen** — derselbe Lauf → PASS; danach `vitest run src/theme` ganz → PASS.
- [x] **Step 5: e2e** `zoom-frei.spec.ts` (Muster `dichte-ableitung.spec.ts`, Seite `/login`, die
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
- [x] **Step 6: e2e laufen** — `cd frontend && mise exec -- pnpm exec playwright test e2e/zoom-frei.spec.ts --trace off` → PASS
  (vorher `cargo build` in der Wurzel, falls die Konfiguration das Binary startet).
- [x] **Step 7: Commit** `feat(frontend): Eingabefelder auf Touch in 16 px, kein Fokus-Zoom (LLH-2043)`.

### Task 3: Regel, Design System, Gate, PR

**Files:**
- Modify: `frontend/AGENTS.md` (Bedien-Leitlinie, Punkt „Kein Zoom wie in einer App“)
- Generated: `docs/design/design-system/**` über `mise exec -- pnpm -C frontend design-system`

- [x] **Step 1: Regel ersetzen** durch „**Zoom frei, Felder 16 px auf Touch** (LLH-2043, umgekehrt
  22.11.2026 gegenüber LLH-1328 „Kein Zoom wie in einer App“): der Viewport in `index.html` sperrt
  nicht; `touch-action: manipulation` in `index.css` sperrt nur den Doppeltipp. Damit iOS beim Fokus
  nicht zoomt, tragen Eingabefelder auf grobem Zeiger `feldSchriftTouch` (16 px, `theme/tokens.ts`,
  Regel in `rollen.css`), auch gegen Inline-Größen. Wächter `theme/zoomFrei.guard.test.ts`, Beleg
  `e2e/zoom-frei.spec.ts`.“ Der Satz „kein Feld wird dafür auf 16 px gehoben“ fällt.
- [x] **Step 2: Design System neu erzeugen**, Diff zeigt nur den Regelwechsel.
- [x] **Step 3: Gate** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [x] **Step 4: Risiko-Specs lokal** (Touch-Felder werden größer): `dichte-ableitung`, `dichte`,
  `betroffene-handy`, `dialoge-handy`, `command-palette`, `verpflegung-empfaenger`,
  `leisten-flaeche` → grün oder Ursache klären (Platz schaffen, nicht abschwächen).
- [x] **Step 5: Bilder** — Anmeldeseite 390 px Touch vorher/nachher (Wegwerf-Spec unter
  `e2e/doku-bilder/zz-qy62952x.bilder.ts`, nicht committen) und in PR und Meldung.
- [x] **Step 6: Commit, Push, PR** gegen `alpha`, Label `voll`, mit Design-Doc, Plan und Teil 1.

---

## Teil 2 — LLH-2045 Feldetikett

Zunder: https://zunder.rubeen.dev/#/aufgabe/vwulh266sj8l1alikldyhqra

Stand `alpha` 58d281fd. Sichtung der 67 Augenbrauen-Aufrufe: neun benennen ein Feld und werden
`Feldetikett`, der Rest sind Köpfe (Paneel, Kennzahl, Bereich, Gruppe, Abschnitt) und bleibt.
Umgestellt werden: `Datenraster.tsx:61` (`Datenfeld`), `DatenfeldEingabe.tsx:71`,
`components/FeldLabel.tsx` (Versalien in `token.fontSizeSM`), `EinsatzdatenPage.tsx:416` (Angabe im
Fugenraster) und `:464`, `lagekarte/Inspector.tsx:141` und `:273` („Koordinate“),
`components/Datensicht.tsx:2715` (Feld der Kartenansicht), `lageberichte/LageberichtUebersicht.tsx:148`
(Kernfeld über dem Auszug, steht unter einem `Datenraster`). Bleiben: u. a. „Letzte Meldung“
(Inspector, Block), Kennzahl-Titel der Ausgabe („Soll“ …), Gruppenköpfe der Kräfte, Feldgruppe
„davon Sonderkost“. Die Kontrast-e2e (`hellmodus-kontrast`) und `pegel-pruefliste` messen nur
Köpfe (Bereichskopf, Paneel, Kennzahl) und bleiben unberührt.

**Review Focus (Teil 2):**
1. Ein `label` im `dt` verliert seine Assoziation (`htmlFor`) → Task 5 prüft `getByLabelText`.
2. `FeldLabel` ändert den Accessible Name, weil das Etikett das Feld umschließt → bleibt über dem
   Feld, `htmlFor`, Test prüft Name exakt.
3. Höhe pro Datenfeld +2,6 px (12 × 1,3 statt 10 × 1,3): Handy-Specs mit „erste Karte im Bild“
   → Risiko-Specs in Task 6.

### Task 4: Baustein `Feldetikett`, Augenbraue ohne `dt`

**Files:**
- Create: `frontend/src/components/instrument/Feldetikett.tsx`, `Feldetikett.test.tsx`
- Modify: `components/instrument/index.ts`, `Augenbraue.tsx`, `Augenbraue.test.tsx`

**Interfaces:**
- Produces: `export default function Feldetikett(props: FeldetikettProps)`,
  `export function feldetikettStil(rollen: Pick<Farbrollen, 'gedaempft'>): CSSProperties`,
  `export type FeldetikettElement = 'span' | 'div' | 'dt' | 'label'`; Props `children`, `als?`
  (Vorgabe `span`), `htmlFor?` (nur bei `label`), `id?`, `className?` — **kein `style`**. Rendert
  `data-lfh="feldetikett"`, Stil `schriftStil('textKlein')`, `lineHeight: 1.3`, Farbe
  `rollen.gedaempft`, `margin: 0`, keine Versalien, keine Sperrung.
- `AugenbraueElement` ohne `'dt'`.

- [x] **Step 1: Tests** `Feldetikett.test.tsx`: `it('benennt ein Feld: 12 px, gemischt, ohne Sperrung, gedämpft')`
  (fontSize `12px`, textTransform leer, letterSpacing leer, color = `gedaempft` des hellen Modus,
  Text im DOM unverändert); `it('als label trägt es htmlFor')` (`getByLabelText` findet das Feld);
  `it('als dt steht es im dl')` (tagName `DT`). In `Augenbraue.test.tsx`:
  `// @ts-expect-error — ein Feld benennt das Feldetikett (LLH-2045)` vor `<Augenbraue als="dt">`.
- [x] **Step 2: rot sehen** — `mise exec -- pnpm -C frontend exec vitest run src/components/instrument/Feldetikett.test.tsx src/components/instrument/Augenbraue.test.tsx`
  → FAIL (Modul fehlt) und Typecheck `mise exec -- pnpm -C frontend exec tsc -b --noEmit` meldet die
  unbenutzte `@ts-expect-error`.
- [x] **Step 3: umsetzen**; Kopfkommentar der Augenbraue: Köpfe, nicht Felder.
- [x] **Step 4: grün sehen** — beide Läufe; Typecheck ist erst nach Task 5 grün (die vier `als="dt"`
  kompilieren nicht mehr), deshalb Task 4 und 5 in einem Commit.

### Task 5: Träger auf `Feldetikett`

**Files:** die neun Stellen oben; Tests `components/FeldLabel.test.tsx`,
`instrument/Datenraster.test.tsx`, `instrument/DatenfeldEingabe.test.tsx`.

- [x] **Step 1: Tests** — `FeldLabel.test.tsx`: Etikett gemischt (textTransform leer, fontSize `12px`,
  `data-lfh="feldetikett"`), Name des Felds exakt der Text. `Datenraster.test.tsx`: das `dt` eines
  `Datenfeld` trägt `data-lfh="feldetikett"`, keine Klasse `lfh-augenbraue`.
  `DatenfeldEingabe.test.tsx`: dasselbe, und `getByLabelText(label)` findet die Eingabe.
- [x] **Step 2: rot sehen** — die drei Dateien → FAIL.
- [x] **Step 3: umstellen.** Abstand, den vorher `style` an der Augenbraue trug (`display: block`,
  `marginBottom`), trägt ein umgebendes `div` bzw. `als="div"`. Kommentare, die „Augenbraue“ für
  das Feld nennen, ziehen mit (Datenraster-Prop-Doku, Datensicht, Einsatzdaten).
- [x] **Step 4: grün sehen** — die drei Dateien, dann `vitest run src/components src/pages/lagekarte src/pages/EinsatzdatenPage src/lageberichte`
  und Typecheck → PASS.
- [x] **Step 5: Commit** `feat(frontend): Feldetikett benennt Felder, Augenbraue bleibt Köpfen (LLH-2045)`.

### Task 6: Regel, Design System, Doku-Bilder, Gate, PR

- [x] **Step 1: Regel** in `frontend/AGENTS.md`, „Bausteine“: `Feldetikett` (Feldname, gemischt,
  `textKlein`/`gedaempft`, `als="dt"|"label"`) neben `Augenbraue` (nur Köpfe; benennt kein Feld).
- [x] **Step 2: Design System** neu erzeugen (`mise exec -- pnpm -C frontend design-system`).
- [x] **Step 3: Anwender-Bilder** alle neu (`mise exec -- pnpm doku:bilder` in `frontend/`, nach
  `cargo build`), nur geänderte Bilder committen; Abweichungen ohne Bezug zum Etikett prüfen.
- [x] **Step 4: Gate** `VITEST_WORKERS=4 ./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [x] **Step 5: Risiko-Specs lokal:** `betroffene-handy`, `dialoge-handy`, `leisten-flaeche`,
  `datensicht-schmal`, `hellmodus-kontrast`, `pegel-pruefliste`, `kopfzeile-schmal`,
  `meldebild-tabelle`, `gate1-ueberlauf` sowie jede Spec, die `Einsatzdaten` oder den
  Lagekarten-Inspector misst (Grep nach `datenfeld`, `einsatzdaten`, `auswahl-`) → grün.
- [x] **Step 6: Bilder** vorher/nachher (Einsatzdaten-Datenraster, Bearbeiten-Modus,
  Lagekarten-Inspector), Commit, Push, PR gegen `alpha` mit Label `voll`.

---

## Teil 3 — LLH-2044 Boden 11 px, Seitentitel 16 px

Zunder: https://zunder.rubeen.dev/#/aufgabe/ebue3pipo8ja2tetp3xc5w0d

Stand `alpha` a09dc207. Unter 11 px liegen drei Stufen (`augenbraue` 10, `railEtikett` 9,
`metaKlein` 10, rund 31 Aufrufer) und acht Schuld-Literale. Davon sind fünf Nicht-Ziele und bleiben:
`fernmeldewesen/skizze/SkizzenElemente.tsx` (7, 9: Fernmeldeskizze),
`pages/lagekarte/LageplanDruck.tsx` (9: Druck), `pages/lagekarte/clusterDonut.ts` (10: Cluster) und
`pages/lagekarte/Sichtungslegende.tsx` (8: Kurzzeichen im Kreis, Abbild des Kartenmarkers). Drei
rasten ein: `lagekarte.css` (Maßstab 10 → `--lfh-typo-meta-*`), `wetter/Verlaufslinie.tsx`
(Prognose-Beschriftung 9 → `monoStil('meta')`), `lagekarte/KartenDetailCard.tsx` (Kachel 9 →
`monoStil('meta')`, Kachel 38 px).

ADR-Nummer: ADR-0087 (0085 belegt der offene PR #1614, 0084 steht auf `alpha` doppelt und wird umnummeriert).

**Review Focus (Teil 3):**
1. Ein Rail-Etikett („ERFASSUNG“) läuft bei 11 px über die 64-px-Rail → `e2e/rail-etikett.spec.ts`
   misst `scrollWidth` und Kasten in jeder Dichte (Task 8).
2. Der Seitentitel 16 px bricht den 44-px-Seitenkopf in `kompakt` oder schiebt Werkzeuge in einen
   Umbruch → `einsatztauglichkeit-layout`, `seitenkopf-werkzeuganteil`, `kraefte-seitenkopf`,
   `kopfzeile-schmal` (Task 12).
3. Augenbraue 11 px bricht Kennzahl-Titel oder Paneelköpfe in zwei Zeilen → Risiko-Specs
   `kennzahl*`, `gate1-ueberlauf`, `leisten-flaeche`, Handy-Specs (Task 12).
4. Ein Aufrufer von `metaKlein` bleibt übrig (CSS-Variable `--lfh-typo-meta-klein-*`) → Typecheck
   und `rollen.guard` (bekannte Variablen) fangen beides (Task 7).

### Task 7: Skala-Werte, Boden-Wächter, `metaKlein` entfällt

**Files:** `theme/tokens.ts`, `theme/rollen.css`, `theme/rollen.guard.test.ts`,
`components/instrument/rollenwerte.ts`, `components/instrument/Augenbraue.test.tsx`, alle
`metaKlein`-Aufrufer (→ `'meta'`).

**Interfaces:** `schriftskala.augenbraue = { groesse: 11, gewicht: 600, familie: 'text', sperrung:
'0.08em', versal: true }`, `railEtikett = { groesse: 11, gewicht: 500, familie: 'text', sperrung:
'0.04em', versal: true }`, `seitentitel.groesse = 16`, `metaKlein` entfällt (Typ `Schriftstufenname`
ohne sie). Export `export const SCHRIFT_BODEN = 11;` in `theme/tokens.ts`.

- [ ] **Step 1: Tests** in `rollen.guard.test.ts`: `it('keine Stufe unter dem Schriftboden 11 px (LLH-2044)')`
  über alle Werte der `schriftskala` (`groesse >= SCHRIFT_BODEN`, `SCHRIFT_BODEN === 11`); Pins
  auf die neuen Werte (Augenbraue, Seitentitel 16, Mono-Stufen 11 bis 14 ohne `metaKlein`,
  `railEtikett`); `--lfh-typo-meta-klein` aus der Liste der bekannten Variablen. Augenbraue-Test:
  `fontSize: '11px'`.
- [ ] **Step 2: rot sehen** — `vitest run src/theme/rollen.guard.test.ts src/components/instrument/Augenbraue.test.tsx` → FAIL.
- [ ] **Step 3: umsetzen** (Werte, CSS-Spiegel, Doku-Kommentare an Skala, `monoStil`, IconRail,
  EinsatzSeite), alle `metaKlein`-Aufrufer auf `meta`.
- [ ] **Step 4: grün sehen** — dieselben Läufe, `vitest run src/theme src/components`, Typecheck → PASS.
- [ ] **Step 5: Commit** `feat(frontend): Schriftboden 11 px, Seitentitel 16 px, metaKlein entfällt (LLH-2044)`.

### Task 8: Rail 64 px

- [ ] **Step 1:** `Kopfleiste.test.tsx` erwartet `railBreite` 64 / 64 / 73; `IconRail.test.tsx`
  Kommentare/Mock auf 64. Rot sehen.
- [ ] **Step 2:** `RAIL_BREITE = 64` in `components/Kopfleiste.tsx`; Kommentare in `rail-etikett.spec.ts`
  (11 px, .04em, 64 px) nachziehen. Grün sehen, dann `e2e/rail-etikett.spec.ts` (alle Dichten) → PASS.
- [ ] **Step 3: Commit** `feat(frontend): Rail 64 px für das 11-px-Etikett (LLH-2044)`.

### Task 9: Schuld unter 11 px einrasten

- [ ] **Step 1:** Schuld senken (`lagekarte.css`, `Verlaufslinie.tsx`, `KartenDetailCard.tsx` je 1 → Eintrag fällt);
  Ratsche läuft rot (mehr Funde als Schuld).
- [ ] **Step 2:** die drei Stellen auf Stufen; Ratsche und betroffene Tests grün.
- [ ] **Step 3: Commit** `refactor(frontend): Schriftgrößen unter 11 px auf Stufen (LLH-2044)`.

### Task 10: ADR-0087, Regel

- [ ] ADR-0087 „Text hat einen Boden von 11 px“ ersetzt ADR-0071: übernimmt deren Regeln (Mono-Stufen
  jetzt `meta` 11 bis `monoGross` 14), neu „MUST NOT: eine Stufe der `schriftskala` unter 11 px“,
  Prüfung mit den Pins von ADR-0071 plus `SCHRIFT_BODEN = 11`; ADR-0071 `status: ersetzt`,
  `ersetzt_durch: ADR-0087`. `frontend/AGENTS.md`, „`schriftskala`“: Boden, Werte, Verweis.
  `scripts/check-all.sh --nur schnell` bzw. `scripts/check-architektur.sh` → grün. Commit.

### Task 11: Design System, Anwender-Bilder

- [ ] Design System neu erzeugen. Anwender-Bilder: Augenbraue, Rail und Seitentitel stehen auf
  fast jeder Ansicht; alle Kapitel neu, committet werden die Bilder, die sich gegenüber einem
  `alpha`-Lauf in derselben Umgebung über das Rauschen hinaus ändern. Commit.

### Task 12: Gate, Risiko-e2e, PR

- [ ] Gate grün; Risiko-Specs aus dem Entwurf („Für jeden Teil gleich“) plus
  `rail-etikett`, `einsatztauglichkeit-layout`, `seitenkopf-werkzeuganteil`, `kraefte-seitenkopf`,
  `kennzahl*`, `hellmodus-kontrast` → grün oder Platz schaffen. Bilder vorher/nachher, PR `voll`.
