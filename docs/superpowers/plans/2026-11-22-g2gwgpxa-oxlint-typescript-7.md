# LLH-2020: oxlint statt ESLint, TypeScript 7 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Frontend lintet mit oxlint, liest eigene AST-Prüfungen über oxc-parser, erzeugt
Typen weiter mit openapi-typescript (über TS 6) und typprüft mit TypeScript 7.

**Architecture:**
- Ein gemeinsamer AST-Helfer (`src/lib/quelltextAst.ts`) über `oxc-parser` ersetzt die
  `ts.createSourceFile`-Schleifen in 11 Dateien. Eine nie committete Gleichheitsprobe vergleicht
  alt (TS 6) und neu über den ganzen Bestand.
- oxlint bekommt die heutigen Regeln einzeln und ein lokales Plugin `lfh` für die e2e-Riegel.
  Ein Vitest-Probe-Test sichert das Plugin.
- Der Codegen lenkt `typescript` per Node-Resolve-Hook auf `@typescript/typescript6`.

**Tech Stack:** oxlint 1.94.0, oxc-parser 0.159.0, typescript 7.0.2, @typescript/typescript6
6.0.2, openapi-typescript 7.13.0, Vitest 5, pnpm 11 über `mise exec`.

**Spec:** `docs/superpowers/specs/2026-11-22-g2gwgpxa-oxlint-typescript-7-design.md`

## Global Constraints

- Node/pnpm nur über `mise exec -- …`. Befehle im Frontend: `cd frontend && mise exec -- pnpm …`.
- Exakte Versionen: `oxlint` `1.94.0`, `oxc-parser` `0.159.0`, `typescript` `7.0.2`,
  `@typescript/typescript6` `6.0.2`. Alle liegen über der Karenzzeit von 24 h.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, LFH-1312). Prosa, Kommentare,
  Testnamen und Commits sind deutsch.
- Gate-Kommandos nie mit `| tail` umschließen.
- Jeder Commit-Body trägt `Zunder: https://zunder.rubeen.dev/#/aufgabe/g2gwgpxa4elxei7a5kxzrefy`
  und die Attribution-Zeilen der Sitzung.
- Mehrfunde der neuen Guards:
  - 1–3 Stellen im selben PR beheben (Code oder begründeter Eintrag in der Erlaubnisliste).
  - Mehr als 3 kommen in die Erlaubnisliste, dazu eine Zunder-Aufgabe.
  - Ein absichtlich blinder Guard ist ausgeschlossen.
  - Jeden Mehrfund im PR unter „Geprüft“ nennen.
- Nichts unter `openspec/` anlegen.

## Review Focus

1. Ein Guard findet nach dem Umbau weniger als vorher, etwa weil `ChainExpression`,
   `ParenthesizedExpression` oder `TSAsExpression` den gesuchten Knoten umhüllen. Abgesichert durch
   die Gleichheitsprobe (Task 2–3) und je einen Selbstbeweis mit `a?.b(…)` im Helfer-Test (Task 1).
2. Eine `.ts`-Datei, die die alten Guards als TSX parsten (Lagekarte), hat Parse-Fehler unter
   oxc. Folge wäre ein leerer AST und damit ein grüner Guard. Abgesichert durch den Helfer, der bei
   `errors.length > 0` wirft (Task 1).
3. Das oxlint-Plugin lädt, aber ein Selektor löst nach einem Update nichts mehr aus. Abgesichert
   durch den Probe-Test mit erwarteter Befundzahl je Musterdatei (Task 4).
4. Eine einzelne `exhaustive-deps`-Warnung oder eine tote Direktive lässt `pnpm lint` grün.
   Abgesichert durch die Mutationsproben (Task 4).
5. `types.generated.ts` ändert sich durch den Hook (Kopf, Reihenfolge). Abgesichert durch
   `git diff --exit-code` im Codegen-Lauf (Task 5).

---

### Task 1: AST-Helfer über oxc-parser

**Files:**
- Modify: `frontend/package.json` (devDependencies `oxc-parser: 0.159.0`,
  `@typescript/typescript6: 6.0.2`), `frontend/pnpm-lock.yaml`
- Create: `frontend/src/lib/quelltextAst.ts`
- Test: `frontend/src/lib/quelltextAst.test.ts`

**Interfaces:**
- Produces:
  - `type AstKnoten = { type: string; start: number; end: number } & Record<string, unknown>`
    (oder die Typen aus `oxc-parser`, wo sie passen).
  - `parseQuelltext(pfad: string, text: string, lang?: 'ts' | 'tsx'): Program`. `lang` folgt
    sonst der Endung. Wirft `Error` mit Pfad und erster Meldung, wenn `errors.length > 0`.
  - `walk(wurzel: AstKnoten, besuch: (knoten: AstKnoten, eltern: AstKnoten | null) => void): void`
    geht über `visitorKeys` in Quelltext-Reihenfolge.
  - `zeileVon(text: string, offset: number): number` liefert 1-basiert.
  - `textVon(text: string, knoten: AstKnoten): string` liefert `text.slice(start, end)`.
  - `istStringLiteral(k): k is { type: 'Literal'; value: string }`.
  - `ohneHuelle(k: AstKnoten): AstKnoten` entfernt `ParenthesizedExpression`,
    `ChainExpression`, `TSAsExpression`, `TSSatisfiesExpression` und `TSNonNullExpression`.
  - Kein `import.meta.glob`; der Helfer nimmt Text entgegen.

- [x] **Step 1: Abhängigkeiten aufnehmen**
  Run: `cd frontend && mise exec -- pnpm add -D oxc-parser@0.159.0 @typescript/typescript6@6.0.2`
  Expected: Lockfile aktualisiert, `pnpm install --frozen-lockfile` danach grün.
- [x] **Step 2: Failing tests schreiben** (`describe('quelltextAst')`):
  - `parseQuelltext('x.tsx', 'const a = <b>Hallo</b>;')`: `walk` findet einen `JSXText` mit `value === 'Hallo'`.
  - `parseQuelltext('x.ts', 'a?.b(\'k\')')`: `walk` findet `CallExpression`; `ohneHuelle` auf dem
    Statement-Ausdruck liefert `CallExpression`.
  - `parseQuelltext('x.ts', 'const = ;')` wirft mit `x.ts` in der Meldung.
  - `zeileVon('a\nb\nc', 4) === 3`, `zeileVon('a', 0) === 1`.
  - `textVon` liefert für `f(1 as any)` das Argument `1 as any`.
  - Die `walk`-Reihenfolge entspricht der Quelltext-Reihenfolge: die Startoffsets der besuchten
    `Identifier` in `a; b; c` sind aufsteigend.
- [x] **Step 3: Rot sehen.**
  Run: `cd frontend && mise exec -- pnpm exec vitest run src/lib/quelltextAst.test.ts`
  Expected: FAIL (Modul fehlt).
- [x] **Step 4: Helfer implementieren.**
- [x] **Step 5: Grün sehen.** Gleicher Lauf, Expected: PASS.
- [x] **Step 6: Commit** `feat(frontend): AST-Helfer über oxc-parser (LLH-2020)`.

### Task 2: Gleichheitsprobe einrichten, Scans `apiTypScan` und `queryKeyScan` umstellen

**Files:**
- Uncommitted:
  - `frontend/src/__alt__/` mit den alten Fassungen per `git show HEAD:…`, dort
    `from 'typescript'` → `from '@typescript/typescript6'`;
  - `frontend/src/__alt__/gleichheit.test.ts`;
  - Eintrag `frontend/src/__alt__/` in `.git/info/exclude`.
- Modify: `frontend/src/api/apiTypScan.ts`, `frontend/src/api/queryKeyScan.ts`
- Test (bestehend): `frontend/src/api/queryKeyScan.test.ts`, `queryKeys.guard.test.ts`,
  `apiResponseTypen.guard.test.ts`

**Interfaces:**
- Consumes: Task 1 (`parseQuelltext`, `walk`, `zeileVon`, `textVon`, `istStringLiteral`, `ohneHuelle`).
- Produces: unveränderte öffentliche Signaturen. `scanneApiTypen(pfad, quelltext): ApiTypFund[]`
  und die Exporte von `queryKeyScan.ts` (`Fund`, `FundArt`, `ENGE_ARTEN`, Scan-Funktion) behalten
  Namen und Typen.
- Gleichheitsprobe: `gleichheit.test.ts` liest per `import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })`
  alle Quellen (ohne `__alt__`). Je Scan ruft sie alt und neu auf und prüft `expect(neu).toEqual(alt)`
  je Datei. Bei einer Abweichung entscheiden die Global Constraints (Mehrfund-Regel).

- [x] **Step 1: Alte Fassungen sichern und Harness anlegen.** Kopien aller 11 Dateien aus
  `HEAD` nach `src/__alt__/<pfad mit _>`. In den Kopien der Guard-Tests nur die Kernfunktion
  behalten, exportiert. Die `describe`-Blöcke kommen raus, damit sie nicht doppelt laufen.
- [x] **Step 2: Harness gegen den unveränderten Stand laufen lassen.**
  Run: `mise exec -- pnpm exec vitest run src/__alt__/gleichheit.test.ts`
  Expected: PASS (alt = alt, beweist die Harness).
- [x] **Step 3: `apiTypScan.ts` umschreiben.** Exportiert heißt:
  `ExportNamedDeclaration.declaration` ist der Knoten. `TSInterfaceDeclaration` → `interface`;
  `TSTypeAliasDeclaration` mit `typeAnnotation.type === 'TSTypeLiteral'` → `objekt-alias`.
- [x] **Step 4: `queryKeyScan.ts` umschreiben** mit Eltern-Zeiger aus `walk`.
  - `PropertyAssignment` → `Property` mit `key.type === 'Identifier'`.
  - Template mit Platzhaltern → `TemplateLiteral` mit `expressions.length > 0`.
  - `isStringLiteralLike` → `istStringLiteral` oder `TemplateLiteral` ohne Ausdrücke.
- [x] **Step 5: Bestehende Tests und Harness grün.**
  Run: `mise exec -- pnpm exec vitest run src/api src/__alt__/gleichheit.test.ts`
  Expected: PASS. Abweichungen nach Mehrfund-Regel behandeln und notieren.
- [x] **Step 6: Commit** (ohne `__alt__`) `refactor(frontend): API- und Query-Key-Scan über oxc-parser (LLH-2020)`.

### Task 3: Die 9 Guard-Tests umstellen

**Files (Modify, jeweils Kernfunktion exportieren, falls noch nicht):**
- `src/command-palette/schnellaktionen.guard.test.ts` (`findeLeser`)
- `src/routing/rollGedaechtnis.guard.test.ts` (`literaleDerAufrufe`)
- `src/components/erreichbarkeit.guard.test.ts` (`texteAus`)
- `src/components/erklaertext.guard.test.ts` (`texteAus`)
- `src/components/speicherfehler.guard.test.ts` (`toastTreffer`)
- `src/components/datensicht.guard.test.ts` (die Funktion(en) mit `ts.`)
- `src/pages/lagekarte/leistenAbstand.guard.test.ts` (`festeAbstaende`)
- `src/pages/lagekarte/kamera.guard.test.ts` (`kameraAufrufe`)
- `src/pages/lagekarte/zeichnungPraefix.guard.test.ts` (`praefixe`)

**Interfaces:**
- Consumes: Task 1, die Harness aus Task 2 (je Guard ein `it` mit alt gegen neu über die
  Dateien, die der Guard heute liest).
- Produces: keine neuen Exporte außer den Kernfunktionen; kein `from 'typescript'` mehr unter
  `frontend/src/`.

- [x] **Step 1: Harness je Guard ergänzen** (alt = alt), Lauf PASS.
- [x] **Step 2: Umschreiben, Guard für Guard.** Die Lagekarte-Guards parsen mit `lang: 'tsx'`
  wie heute. Abbildung der Knoten (Design-Doc, Abschnitt 5):
  - `JsxText` → `JSXText.value`;
  - Template-Teile → `TemplateLiteral.quasis[].value.cooked`;
  - `NumericLiteral` → `Literal` mit Zahl, Text per `textVon` (`knoten.text` war der Quelltext);
  - `PrefixUnaryExpression` mit Minus → `UnaryExpression operator '-'`;
  - Kurzform → `Property.shorthand`.
- [x] **Step 3: Alle Guards und die Harness grün.**
  Run: `mise exec -- pnpm exec vitest run src/__alt__ src/command-palette/schnellaktionen.guard.test.ts src/routing src/components/erreichbarkeit.guard.test.ts src/components/erklaertext.guard.test.ts src/components/speicherfehler.guard.test.ts src/components/datensicht.guard.test.ts src/pages/lagekarte`
  Expected: PASS.
- [x] **Step 4: Kein TS-Import mehr.**
  Run: `git grep -n "from 'typescript'" frontend/src`
  Expected: keine Ausgabe.
- [x] **Step 5: Commit** `refactor(frontend): Guard-Tests lesen den Quelltext über oxc-parser (LLH-2020)`.
  Harness bleibt bis Task 6 liegen, danach löschen.

### Task 4: oxlint mit Riegel-Plugin, ESLint entfernen

**Files:**
- Create:
  - `frontend/.oxlintrc.json`. Start ist die Fassung aus
    `…/scratchpad/lint-vergleich/ox/.oxlintrc.json`; Plugin-Pfad `./lint/riegel-plugin.js`; die
    Kommentare der Ausnahmeliste aus `eslint.config.js` übernehmen.
  - `frontend/lint/riegel-plugin.js`
  - `frontend/lint/riegel-plugin.test.ts`
- Modify:
  - `frontend/package.json`:
    - `"lint": "oxlint --deny-warnings --report-unused-disable-directives"`;
    - `+oxlint@1.94.0`;
    - `−eslint −@eslint/js −typescript-eslint −eslint-plugin-react-hooks`.
  - `frontend/vite.config.ts`: `test.include` + `'lint/**/*.test.ts'`.
  - `frontend/tsconfig.json`: `include` + `"lint"`.
  - Alle Dateien mit `eslint-disable-next-line`, 42 Stellen laut `git grep -c`.
- Delete: `frontend/eslint.config.js`

**Interfaces:**
- Produces: Plugin `lfh` mit den Regeln `e2e-riegel` und `e2e-anmeldeformular`. Die Selektoren und
  Meldungen kommen wörtlich aus `eslint.config.js`. Die eine Meldung, die auf
  `frontend/eslint.config.js` verweist, zeigt künftig auf `frontend/.oxlintrc.json`.

- [x] **Step 1: Failing Probe-Test schreiben** (`describe('Riegel-Plugin lfh')`):
  - Aufbau:
    - Temp-Verzeichnis (`mkdtempSync`) mit `.oxlintrc.json`: Kopie der echten Datei, `jsPlugins`
      auf den absoluten Plugin-Pfad, `ignorePatterns` leer.
    - Lauf `node_modules/.bin/oxlint --format json -c <tmp>/.oxlintrc.json <tmp>`, `cwd` = tmp.
  - `e2e/probe-aussen.spec.ts` mit den 4 Verstößen: 4 Befunde, je einer pro Zeile, Regeln
    `lfh(e2e-riegel)` ×3 und `lfh(e2e-anmeldeformular)` ×1.
  - `e2e/kernfluss.spec.ts` mit denselben 4 Zeilen: 3 Befunde, keiner zur Anmeldung.
  - `e2e/gegenprobe.spec.ts` mit `'load'`, `'Speichern'`, `'Passwort'` und einem Template-Literal
    `` `networkidle` ``: 0 Befunde.
  - `e2e/unterdrueckt.spec.ts` mit `// oxlint-disable-next-line lfh/e2e-riegel` vor `networkidle`:
    0 Befunde.
  - `src/probe.ts` mit `waitForLoadState('networkidle')` außerhalb von `e2e/`: 0 Befunde.
- [x] **Step 2: Rot sehen.**
  Run: `mise exec -- pnpm exec vitest run lint/riegel-plugin.test.ts`
  Expected: FAIL (Plugin/Config fehlt).
- [x] **Step 3: oxlint installieren, Config und Plugin anlegen.** Danach Probe-Test PASS.
- [x] **Step 4: Kommentare umstellen.** `eslint-disable-next-line react-hooks/exhaustive-deps` →
  `oxlint-disable-next-line react-hooks/exhaustive-deps`, analog für `no-restricted-imports` und
  `@typescript-eslint/no-explicit-any`. `no-restricted-syntax` wird zu `lfh/e2e-riegel`.
  Begründungstexte bleiben. Regelnamen nehmen, die oxlint als gültig meldet.
- [x] **Step 5: ESLint-Pakete und `eslint.config.js` entfernen; Lint grün.**
  - Run: `mise exec -- pnpm lint`, Expected: Exit 0, 0 Befunde.
  - Run: `git grep -n eslint frontend -- ':!*.md' ':!pnpm-lock.yaml'`, Expected: nur bewusste
    Reste (Begründungstext), keine Konfiguration.
- [x] **Step 6: Mutationsproben** (je eine Änderung, `pnpm lint` → Exit ≠ 0, dann zurück; Ergebnis
  für den PR notieren):
  - `import { Select } from 'antd'` in einer Seite;
  - `import { Tag } from 'antd'`;
  - `import * as antd from 'antd'; antd.Select`;
  - bedingter Hook-Aufruf (`rules-of-hooks`);
  - eine entfernte `exhaustive-deps`-Direktive (Warnung → rot);
  - eine tote `oxlint-disable-next-line` über einer sauberen Zeile.
- [x] **Step 7: Prettier über die neuen Dateien.**
  Run: `cd .. && ./scripts/check-fmt.sh`
  Expected: grün.
- [x] **Step 8: Commit** `build(frontend): oxlint ersetzt ESLint, e2e-Riegel als Plugin mit Probe-Test (LLH-2020)`.

### Task 5: Codegen über TS 6

**Files:**
- Create: `frontend/scripts/ts6-fuer-codegen.mjs`
- Modify: `frontend/package.json`. Das Skript `gen:types` wird zu
  `node --import ./scripts/ts6-fuer-codegen.mjs node_modules/openapi-typescript/bin/cli.js src/api/openapi.json -o src/api/types.generated.ts`.
  Den CLI-Pfad prüfen: `bin` in `node_modules/openapi-typescript/package.json`.

**Interfaces:**
- Produces: Der Hook registriert per `registerHooks` aus `node:module` einen `resolve`, der
  `specifier === 'typescript'` aus einem `parentURL` mit `/openapi-typescript/` auf
  `@typescript/typescript6` lenkt. Der Kopfkommentar nennt den Grund und den Rückbau, sobald
  openapi-typescript TS 7 unterstützt.

- [x] **Step 1: Ausgangslage sichern.**
  Run: `mise exec -- pnpm gen:types && git diff --exit-code src/api/types.generated.ts`
  Expected: Exit 0 (noch mit TS 6).
- [x] **Step 2: Hook anlegen, Skript umstellen, erneut erzeugen.** Gleicher Befehl,
  Expected: Exit 0.
- [x] **Step 3: Nachzug in Zunder anlegen** (`zunder-task-anlegen`): Hook zurückbauen, sobald
  openapi-typescript TS 7 trägt.
- [x] **Step 4: Commit** `build(frontend): Typ-Codegen läuft über @typescript/typescript6 (LLH-2020)`.

### Task 6: TypeScript 7

**Files:**
- Modify:
  - `frontend/package.json` (`typescript: 7.0.2`; `typecheck`/`build` prüfen, s. u.);
  - `frontend/src/command-palette/useSchnellaktionZaehler.test.tsx:34`;
  - `frontend/src/command-palette/useZuletztBefehle.test.tsx:55`.

- [x] **Step 1: Hochziehen.** `mise exec -- pnpm add -D typescript@7.0.2`.
- [x] **Step 2: Rot sehen.**
  Run: `mise exec -- pnpm typecheck`
  Expected: genau die zwei TS2454 zu `gets`.
- [x] **Step 3: `gets` eindeutig zuweisen**, etwa `let gets = 0`, bzw. dort, wo es deklariert ist.
  Das Verhalten der Tests bleibt.
- [x] **Step 4: Heap-Schalter prüfen.** Bleibt `node --max-old-space-size=4096` sinnvoll? `bin/tsc`
  von TS 7 ist ein Node-Starter für das Go-Binary. Den Spitzenbedarf messen:
  `/usr/bin/time -v mise exec -- node node_modules/typescript/bin/tsc --noEmit`, Wert „Maximum
  resident set size“. Liegt Node selbst deutlich unter 2 GB, Schalter aus `typecheck`/`build`
  entfernen.
- [x] **Step 5: Grün sehen.**
  - Run: `mise exec -- pnpm typecheck && mise exec -- pnpm build`, Expected: Exit 0.
  - Run: `mise exec -- pnpm exec vitest run src/__alt__ lint src/lib`, Expected: PASS (der
    Helfer und die Probe laufen ohne `typescript`-API).
  - Danach `src/__alt__/` löschen und den Eintrag in `.git/info/exclude` entfernen.
- [x] **Step 6: Commit** `build(frontend): TypeScript 7.0.2 (LLH-2020)`.

### Task 7: Regeln, Doku, ADR

**Files:**
- Modify:
  - `frontend/AGENTS.md`: „Lint-Disziplin“, die ESLint-Verweise bei antd `Tag` (~691, ~1400),
    „Heap für `tsc`“ nach Task 6 Step 4.
  - `frontend/e2e/AGENTS.md` (Zeilen 17, 47).
  - `scripts/AGENTS.md` (Zeile 7, falls ESLint genannt).
  - `.devcontainer/devcontainer.json`: `dbaeumer.vscode-eslint` → `oxc.oxc-vscode`.
  - `docs/architektur/02-randbedingungen.md` (TypeScript 7, oxlint).
  - `docs/architektur/08-querschnittliche-konzepte.md` (Codegen-Kette mit TS-6-Hook).
  - `docs/architektur/11-risiken-und-technische-schulden.md`: Alpha-API des Plugins, TS-6-Rest.
  - Code-Kommentare mit Verweis auf `eslint.config.js`
    (`git grep -n "eslint" frontend/src frontend/e2e`).
- Create: `docs/architektur/entscheidungen/ADR-<nnnn>-frontend-lintet-mit-oxlint-ast-pruefungen-ueber-oxc-parser.md`.
  `<nnnn>` ist die nächste freie Nummer nach `git fetch origin alpha` und
  `scripts/adr-fuer.sh --alle`.

**Interfaces:**
- ADR-Kopf nach `VORLAGE.md`:
  - `status: akzeptiert`;
  - `gilt_fuer: [frontend/.oxlintrc.json, frontend/lint/**, frontend/package.json, frontend/src/lib/quelltextAst.ts]`;
  - `herleitung`: Design-Doc.
- Regeln:
  - MUST NOT `eslint` als Abhängigkeit des Frontends;
  - MUST NOT `from 'typescript'` unter `frontend/src/**`;
  - MUST e2e-Riegel im Plugin `lfh` mit Probe-Test;
  - MUST `lint` mit `--deny-warnings` und `--report-unused-disable-directives`.
- Prüfung:
  - `verbiete '"eslint"' 'frontend/package.json'`
  - `verbiete "from 'typescript'" 'frontend/src/**/*.ts' 'frontend/src/**/*.tsx'`
  - `verlange 'deny-warnings' 'frontend/package.json'`
  - `verlange 'report-unused-disable-directives' 'frontend/package.json'`
  - `verlange 'e2e-riegel' 'frontend/lint/riegel-plugin.js'`

- [x] **Step 1: Texte ändern** und `scripts/adr-fuer.sh frontend/.oxlintrc.json` aufrufen. Expected: die neue ADR erscheint.
- [x] **Step 2: ADR-Wächter und Doku-Gates.**
  Run: `./scripts/check-all.sh --nur schnell`
  Expected: grün (Prettier, ADR-Prüfung, OpenSpec-Wächter).
- [x] **Step 3: Commit** `docs: oxlint und TypeScript 7 in Regeln, Architektur und ADR (LLH-2020)`.

### Task 8: Gesamtlauf

- [x] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` (ein Aufruf, ggf. im Hintergrund). Expected: grün.
- [x] **Step 2:** `./scripts/check-typ-codegen.sh`. Expected: `OK: Backend↔Frontend-Typen sind in Sync.`
- [x] **Step 3:** Ergebnisse, Mutationsproben und Mehrfunde für den PR unter „Geprüft“ notieren.

## Abweichungen bei der Umsetzung (22.11.2026)

- Der Helfer heißt nach dem Review `src/lib/sourceAst.ts` mit englischer API (`parseSource`,
  `walk`, `lineOf`, `textOf`, `staticText`, `visibleTexts`, `isStringLiteral`), Bezeichner-Regel
  LFH-1312; `ohneHuelle` entfiel ungenutzt. `walk` besucht Kinder nach Startoffset sortiert und
  kann per `false` den Abstieg unterbinden.
- Die Lagekarte-Guards parsen nach Dateiendung statt erzwungen als TSX (oxc wirft bei `.ts` mit
  Generics als TSX); die Gleichheitsprobe zeigte keine Abweichung und keinen Mehrfund.
- `no-unused-vars` ignoriert `_`-Namen nicht (wie zuvor ESLint), im Probe-Test belegt.
- `typecheck`/`build` rufen `tsc` ohne Node-Heap-Schalter: `bin/tsc` startet per `execve` das
  Go-Binary.
- ADR-0089: 0082 und 0083 wurden während der Arbeit auf `alpha` vergeben, 0084 belegen offene PRs.
- Task 8, Step 1: lokal in Bündeln gefahren (`--nur schnell`, `--nur frontend`, `--nur rust` mit
  `CARGO_INCREMENTAL=0`), weil der volle Lauf das Plattenkontingent der Sitzung sprengte; die
  übrigen Suiten fährt der PR mit Label `voll`.
