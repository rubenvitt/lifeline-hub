# Mono-Stufen statt `monoStil` mit freier Größe — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mono-Größen kommen aus Stufen der `schriftskala`, die Schriftgrößen-Ratsche zählt `monoStil(<Zahl>)`.

**Architecture:** Die Skala in `theme/tokens.ts` bekommt vier Mono-Stufen, die `rollen.css`
spiegelt. `monoStil` nimmt eine Stufe oder eine Zahl aus einer Variablen. Ein Wegwerf-Skript
stellt die Aufrufe pixelgleich um. Die Ratsche zählt Zahl-Literale in `monoStil`, und die
Ausreißer kommen einmalig in die Schuld (ADR-0070 ersetzt ADR-0065).

**Tech Stack:** TypeScript, React, Vitest (Frontend unter `frontend/`, `mise exec -- pnpm …`).

**Spec:** `docs/superpowers/specs/2026-11-19-ldu5dmkb-mono-stufen-design.md`

## Global Constraints

- Pixelgleich: Kein gerendertes Element ändert Größe, Gewicht, Sperrung oder Familie.
- Stufen: `metaKlein` 10, `meta` 11, `monoKlein` 12, `mono` 13, `monoGross` 14; alle `familie: 'zahl'`, `gewicht: 400`, ohne Sperrung.
- CSS-Präfixe: `--lfh-typo-meta-klein`, `--lfh-typo-mono-klein`, `--lfh-typo-mono`, `--lfh-typo-mono-gross`.
- 13 px gibt es nur als Mono-Stufe `mono` (freigegeben 19.11.2026).
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, Bezeichner-Sprache).

## Review Focus

- `monoStil('datenwertGross')` darf die Sperrung `-0.02em` der Stufe nicht übernehmen (pixelgleich), Test in Task 2.
- `monoStil('mono')` ohne Gewicht nimmt 400, `monoStil('datenwertKlein')` 500 (Gewicht der Stufe), Test in Task 2.
- Eine Zahl aus einer Variablen bleibt erlaubt und ungezählt (`monoStil(token.fontSize)`), Test in Task 4.
- `monoStil( 12 , 500)` mit Leerzeichen zählt, `monoStil(12.5)` zählt, Test in Task 4.
- Eine Text-Stufe (`'text'`) ist für `monoStil` ein Typfehler, belegt durch `tsc` in Task 2 (`// @ts-expect-error` im Test).

---

### Task 1: Mono-Stufen in der Skala und im CSS-Spiegel

**Files:**
- Modify: `frontend/src/theme/tokens.ts` (`schriftskala`, ~Z. 835)
- Modify: `frontend/src/theme/rollen.css` (Schriftskala-Block, ~Z. 182–216)
- Test: `frontend/src/theme/rollen.guard.test.ts` (`TYPO_ABBILDUNG`, Pin-Test der Entwurfswerte)

**Interfaces:**
- Produces: `schriftskala.metaKlein | monoKlein | mono | monoGross` (`{ groesse, gewicht: 400, familie: 'zahl' }`).

- [ ] **Step 1:** `TYPO_ABBILDUNG` um die vier Stufen ergänzen. Im Pin-Test `it('pinnt die Mono-Stufen (LLH-1972)')`: `[metaKlein, meta, monoKlein, mono, monoGross].map(s => [s.groesse, s.gewicht, s.familie])` ergibt `[[10,400,'zahl'],[11,400,'zahl'],[12,400,'zahl'],[13,400,'zahl'],[14,400,'zahl']]`.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/theme/rollen.guard.test.ts`, erwartet: FAIL (Typfehler bzw. fehlende Stufe).
- [ ] **Step 3:** Die Stufen in `schriftskala` neben `meta` einfügen, je mit einem Kommentar (Größe und Verwendung). Den CSS-Spiegel (`-groesse`, `-gewicht`) in `rollen.css` ergänzen.
- [ ] **Step 4:** Test wie in Step 2, erwartet: PASS.
- [ ] **Step 5:** Commit `feat(theme): Mono-Stufen metaKlein, monoKlein, mono, monoGross`.

### Task 2: `monoStil` nimmt eine Stufe

**Files:**
- Modify: `frontend/src/components/instrument/rollenwerte.ts:76-84`
- Test: `frontend/src/components/instrument/rollenwerte.test.ts`

**Interfaces:**
- Consumes: Stufen aus Task 1.
- Produces: `export type Monostufe` (Stufen mit `familie: 'zahl'`); `monoStil(groesse: Monostufe | number, gewicht?: 400 | 500): { fontFamily; fontSize: number; fontWeight: number; fontVariantNumeric: 'tabular-nums' }`.

- [ ] **Step 1:** Tests ergänzen: `monoStil('mono')` toEqual `{ fontFamily: schrift.zahl, fontSize: 13, fontWeight: 400, fontVariantNumeric: 'tabular-nums' }`; `monoStil('monoKlein', 500).fontWeight` = 500; `monoStil('datenwertGross')` toEqual `{ …, fontSize: 40, fontWeight: 500 }` und hat **kein** `letterSpacing`; `monoStil(17)` = fontSize 17, Gewicht 400; `// @ts-expect-error` vor `monoStil('text')`.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/components/instrument/rollenwerte.test.ts`, erwartet: FAIL.
- [ ] **Step 3:** `Monostufe` und die neue Signatur umsetzen. Eine Stufe liefert Größe und, wenn `gewicht` fehlt, ihr Gewicht; eine Zahl liefert Gewicht 400. Doc-Kommentar: Zahl nur aus Variablen, Literale zählt `schriftgroesse.guard.test.ts`.
- [ ] **Step 4:** Test wie Step 2 → PASS; `mise exec -- pnpm -C frontend exec tsc --noEmit -p .`, erwartet: kein Fehler (alte Zahl-Aufrufe bleiben gültig).
- [ ] **Step 5:** Commit `feat(instrument): monoStil nimmt eine Mono-Stufe`.

### Task 3: Aufrufe pixelgleich umstellen

**Files:**
- Modify: alle `frontend/src/**/*.tsx|ts` mit `monoStil(<Literal>`; `frontend/src/components/feld.guard.test.ts:155`
- Wegwerf: Umstellungsskript im Scratchpad, nicht committet

**Interfaces:**
- Consumes: `monoStil(Monostufe, gewicht?)` aus Task 2.

- [ ] **Step 1:** Ersetzen per Skript, nur wenn das erste Argument ein Literal ist: 10→`'metaKlein'`, 11→`'meta'`, 12→`'monoKlein'`, 13→`'mono'`, 14→`'monoGross'`. Das Gewicht bleibt erhalten. `(22, 500)`→`('datenwertKlein')`, `(40, 500)`→`('datenwertGross')`. Ternäre Literale per Hand (`hoehe >= 30 ? 'mono' : 'monoKlein'`). Auch `monoStil(schriftskala.meta.groesse)` wird `monoStil('meta')`.
- [ ] **Step 2:** `grep -rnE "monoStil\(\s*[0-9]" frontend/src --include=*.ts --include=*.tsx | grep -v '\.test\.'` listet nur noch 8, 9, 15, 16, 20, 24, 28 (und Ausdrücke mit 18).
- [ ] **Step 3:** `tsc --noEmit` ohne Fehler, Prettier über die geänderten Dateien (`mise exec -- pnpm -C frontend exec prettier --write <dateien>`), `vitest run` für `src/components` grün.
- [ ] **Step 4:** Commit `refactor: monoStil-Aufrufe auf Mono-Stufen umgestellt`.

### Task 4: Ratsche zählt `monoStil(<Zahl>)`

**Files:**
- Modify: `frontend/src/theme/schriftgroesse.guard.test.ts` (Muster, Kopf „Bekannte Grenzen“, Regeltest)
- Modify: `frontend/src/theme/schriftgroesse.schuld.ts`

- [ ] **Step 1:** Regeltest `it('meldet monoStil mit Zahl, keine Stufe und keine Variable')`: Text `'monoStil(11);\nmonoStil( 12 , 500);\nmonoStil(12.5);\nmonoStil("mono");\nmonoStil(token.fontSize);'` ergibt `[{zeile:1,wert:11},{zeile:2,wert:12},{zeile:3,wert:12.5}]`. Im bisherigen Test „meldet Zahlen und px-Strings …“ fliegt `monoStil(11)` aus der Erwartung „zählt nicht“; Zeile `d` wird `monoStil('meta')`.
- [ ] **Step 2:** `vitest run src/theme/schriftgroesse.guard.test.ts`, erwartet: FAIL.
- [ ] **Step 3:** `MONO_ZAHL = /\bmonoStil\(\s*(\d+(?:\.\d+)?)\s*[,)]/g` in die TS-Muster aufnehmen. Kopf: Grenze 1 = „Werte aus Variablen und Ausdrücken zählen nicht“. Schuld je Datei der Ausreißer eintragen (die Meldungen des Wächters nennen sie).
- [ ] **Step 4:** Test wie Step 2, erwartet: PASS.
- [ ] **Step 5:** Commit `feat(theme): Schriftgrößen-Ratsche zählt monoStil mit Zahl`.

### Task 5: Regeln nachziehen

**Files:**
- Create: `docs/architektur/entscheidungen/ADR-0070-mono-groessen-kommen-aus-stufen-der-schriftskala.md` (Nummer vorher gegen `origin/alpha` prüfen)
- Modify: `docs/architektur/entscheidungen/ADR-0065-*.md` (nur Kopf: `status: ersetzt`, `ersetzt_durch: ADR-0070`)
- Modify: `frontend/AGENTS.md`, „`schriftskala`“

- [ ] **Step 1:** ADR-0070 nach `VORLAGE.md`, `ersetzt: ADR-0065`. Übernimmt alle Regeln von ADR-0065; neu: MUST `monoStil` nimmt eine Stufe (`Monostufe`), MUST NOT `monoStil` mit Zahl-Literal; die Schuld-Regel erlaubt die einmalige Einbuchung der Mono-Ausreißer vom 19.11.2026. Die Prüfung übernimmt die von ADR-0065 und dazu `verlange "monoStil\\\\\\(" frontend/src/theme/schriftgroesse.guard.test.ts` sowie `verlange 'mono: \{ groesse: 13' frontend/src/theme/tokens.ts`. Unter 80 Zeilen.
- [ ] **Step 2:** `frontend/AGENTS.md`: „13 px gibt es nicht“ wird zu „13 px gibt es nur als Mono-Stufe `mono`“. Dazu ein Satz: Mono-Größen nimmt `monoStil(stufe)` (`metaKlein` 10 bis `monoGross` 14, `datenwert*`), eine Zahl nur aus Variablen.
- [ ] **Step 3:** `scripts/adr-fuer.sh frontend/src/theme/tokens.ts` nennt ADR-0070; `./scripts/check-all.sh --nur schnell` (ADR-Wächter, Prettier) ist grün.
- [ ] **Step 4:** Commit `docs: ADR-0070 Mono-Stufen ersetzt ADR-0065, frontend/AGENTS.md`.

### Task 6: Pixelgleichheit belegen und Gates

- [ ] **Step 1:** Bildvergleich vor/nach (Wegwerf-Spec `frontend/e2e/doku-bilder/zz-ldu5dmkb.bilder.ts`, Bilder außerhalb von `docs/anwender/bilder/`): Überblick, ETB, Lagemeldungen auf `origin/alpha` und auf dem Branch. Erwartet: pixelgleich (Differenz 0).
- [ ] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e`, erwartet: grün.
