# LLH-2020: oxlint statt ESLint, TypeScript 7 im Frontend

Zunder: https://zunder.rubeen.dev/#/aufgabe/g2gwgpxa4elxei7a5kxzrefy · Route `entwurf` (E1
Werkzeugwahl, E2 Lint-Regeln in `frontend/AGENTS.md`, E3 `frontend/` + `.claude`/`AGENTS.md`) ·
Lösungsweg am 22.11.2026 abgestimmt.

## Absicht

Das Frontend soll auf **TypeScript 7** (Go-Compiler) wechseln. TS 7 liefert die klassische
JS-Compiler-API nicht mehr; `typescript` exportiert nur noch `lib/version.cjs` und
`typescript/unstable/*`. Alles, was heute `import * as ts from 'typescript'` braucht, muss
vorher einen anderen Weg haben:

1. **Lint-Gate:** typescript-eslint 8.73 verlangt `typescript <6.1`. Der Mensch wollte ohnehin
   ein moderneres Werkzeug als ESLint.
2. **11 Guard-Tests und Scans**, die mit `ts.createSourceFile`/`forEachChild` den AST lesen.
3. **Typ-Codegen** (`openapi-typescript` 7.13, Peer `typescript ^5.x`).

Ein Nebeneffekt, der den Wechsel trägt: Typecheck 60 s → ~10 s, Lint 40 s → <1 s (gemessen
22.11.2026, Cloud-Sitzung, 4 Kerne).

## Ziele

- `typescript` 7.0.2 im Frontend; `typecheck` und `build` laufen mit dem Go-Compiler.
- **oxlint** ersetzt ESLint vollständig (`eslint`, `@eslint/js`, `typescript-eslint`,
  `eslint-plugin-react-hooks`, `frontend/eslint.config.js` entfallen).
- Jeder heutige Lint-Riegel greift weiter, belegt durch eine Mutationsprobe je Riegel.
- Die 11 AST-Nutzer lesen den Quelltext mit **oxc-parser** (ESTree) und finden genau dasselbe
  wie heute.
- `scripts/check-typ-codegen.sh` bleibt grün; `types.generated.ts` ändert sich nicht.

## Nicht-Ziele

- Keine neuen Lint-Regeln, auch nicht die React-Compiler-Regeln von react-hooks 7 oder
  typbewusstes Linten (`oxlint-tsgolint`). Das Regelset bleibt das heutige.
- Prettier bleibt Formatierer; kein Formatierer-Wechsel.
- `website/` bleibt, wie es ist (eigene Abhängigkeiten).
- Kein Ersatz für openapi-typescript.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn alles grün ist)

- Ein Guard, der nach der Umstellung still weniger findet (ESTree-Knoten anders benannt, JSX-Text
  oder Template-Teile übersehen) und deshalb grün bleibt.
- Ein e2e-Riegel, der nach einem oxlint-Update still nicht mehr greift (JS-Plugin-API ist Alpha).
- `exhaustive-deps` meldet nach dem Wechsel an anderen Stellen, und jemand schaltet die Regel
  deshalb ab.

## Randbedingungen

- Karenzzeit 24 h (`pnpm-workspace.yaml`, `minimumReleaseAge`): oxlint 1.94.0 (16.11.),
  oxc-parser 0.159.0 (16.11.), typescript 7.0.2 (08.07.), `@typescript/typescript6` 6.0.2
  (06.07.) erfüllen sie.
- Node und pnpm nur über `mise exec` (`AGENTS.md`, Qualitäts-Gates).
- `pnpm lint` bleibt der Name des Gate-Schritts (`scripts/check-all.sh`, Schritt 2) und läuft
  mit null Warnungen.
- ADR-Pflicht für die Werkzeugwahl (`docs/architektur/AGENTS.md`, Mitänderungsregel).

## Ansätze (abgestimmt am Phase-1-Checkpoint)

**Linter.**
- **oxlint 1.94 — gewählt.** 71 von 72 heutigen TS-Regeln vorhanden. Es fehlt nur `no-octal`,
  das im Modulcode ohnehin ein Syntaxfehler ist. `exhaustive-deps` meldet an denselben 38 Hooks
  wie ESLint, keine neue Stelle; `eslint-disable`-Kommentare wirken als Alias. Laufzeit 0,7 s.
  Preis: die e2e-Riegel brauchen ein lokales JS-Plugin, dessen API Alpha ist.
- **Biome 2.6.8 — verworfen.**
  - 6 Regeln fehlen oder messen anders (`no-empty`, `no-cond-assign`, `no-prototype-builtins` …).
  - `useExhaustiveDependencies` meldet an 73 Stellen mehr bzw. −6/+5.
  - Alle 42 Kommentare müssten umgebaut werden, 35 davon an eine andere Zeile.
  - `import * as antd` bleibt ungesperrt.

**e2e-Riegel.**
- **Lokales oxlint-Plugin + Probe-Test — gewählt.** Dieselben vier esquery-Selektoren als
  Visitor-Schlüssel; die Meldung erscheint im Editor. Ein Vitest-Test lintet Musterdateien und
  wird rot, wenn ein Update die Riegel bricht.
- **Reiner Vitest-Guard — verworfen.** Ohne Meldung im Editor; die Ausnahme in
  `e2e/einsatz-kern.ts` bräuchte eine eigene Liste.

**Guard-Parser.**
- **oxc-parser (ESTree) — vom Menschen gewählt.** Passt zu oxlint, ist schnell und hängt nicht am
  TS-Release-Rhythmus. Preis: alle 11 Dateien werden umgeschrieben.
- **`@typescript/typescript6` — nicht gewählt.** Nur die Importzeile hätte sich geändert, die
  Guards hingen aber am auslaufenden TS-6-Zweig.
- **`typescript/unstable/*` — verworfen.** Parst nur über einen Go-Prozess je Projekt, die API
  ist instabil.

**Codegen.**
- **`@typescript/typescript6` über einen Node-Resolve-Hook — gewählt.** Gemessen: dieselben Typen
  wie heute; nur den Dateikopf schreibt die CLI.
- **pnpm-`overrides` und `packageExtensions` — verworfen.** Beide greifen nicht, weil `typescript`
  bei openapi-typescript eine Peer-Abhängigkeit ist; vom Root gewinnt dann TS 7.

## Entscheidungen zum Wie

### 1. oxlint-Konfiguration

`frontend/.oxlintrc.json` bildet das heutige Set ab, Regel für Regel aus
`eslint --print-config` gezogen. Ein Startpunkt mit allen Regeln liegt im Vergleich vom
22.11.2026 (s. Herleitung unten):

- `categories.correctness: off`; die heutigen Regeln werden einzeln aufgezählt, damit oxlint-Updates
  keine neuen Regeln einschalten.
- `react/rules-of-hooks: error`, `react/exhaustive-deps: warn`.
- `no-restricted-imports` mit `paths` für antd `Select` und `Tag`, Meldungen wörtlich wie heute.
- Override für `**/*.{js,mjs,cjs}`: die Regeln, die ESLint heute nur für JS-Dateien zusätzlich
  aktiviert (`no-undef`, `no-unreachable` …), dazu die Globals für `public/**/*.js` und
  `scripts/**/*.{js,mjs}`.
- `ignorePatterns` wie heute (`dist`, `playwright-report`, `src/api/types.generated.ts` …).
- `package.json`: `"lint": "oxlint --deny-warnings --report-unused-disable-directives"`
  (Optionen in oxlint 1.94 vorhanden). `--deny-warnings` macht wie heute `--max-warnings 0` jede
  `exhaustive-deps`-Warnung rot. `--report-unused-disable-directives` hält eine Prüfung, die
  ESLint 10 heute stillschweigend fährt (`reportUnusedDisableDirectives: "warn"`, mit
  `--max-warnings 0` rot): eine tote Direktive bricht das Gate. Das ist die Regel „keine toten
  Direktiven“ aus `frontend/AGENTS.md` und gehört zu den Riegeln mit Mutationsprobe.

### 2. Riegel-Plugin

`frontend/lint/riegel-plugin.js` (eigenes Verzeichnis für Lint-Bausteine):

- Ein Plugin `lfh` mit zwei Regeln. `e2e-riegel` trägt die drei Selektoren aus `E2E_RIEGEL`,
  `e2e-anmeldeformular` den einen aus `E2E_RIEGEL_ANMELDEFORMULAR`. Selektoren und Meldungen
  bleiben wörtlich; der Verweis „Liste in `frontend/eslint.config.js`“ zeigt künftig auf
  `frontend/.oxlintrc.json`.
- Override `e2e/**/*.ts` schaltet beide Regeln ein. Ein zweiter Override mit der heutigen
  Ausnahmeliste (`e2e/rollen-kern.ts` … `e2e/doku-bilder/**/*.ts`) schaltet
  `lfh/e2e-anmeldeformular` aus.
- Der Kopfkommentar trägt die Herkunft der Riegel (LFH-385, LFH-1114, LLH-1665) und deren
  Begründung aus `eslint.config.js`. Die Ausnahmeliste bekommt ihre Zeilenkommentare in
  `.oxlintrc.json` (JSONC).

### 3. Probe-Test für das Plugin

`frontend/lint/riegel-plugin.test.ts` (Vitest):

- Er legt in einem Temp-Verzeichnis eine Kopie der Konfiguration an, mit absolutem Plugin-Pfad,
  dazu Musterdateien unter `e2e/`. Dann startet er das oxlint-Binary aus `node_modules/.bin` mit
  `--format json`.
- Zu prüfen:
  - Jeder der vier Selektoren ist in einer nicht ausgenommenen Datei rot.
  - In einer ausgenommenen Datei sind die drei allgemeinen rot und die Anmeldezeile grün.
  - Gegenproben (`'load'`, `'Speichern'`, `'Passwort'`, Template-Literal) bleiben grün.
  - Ein `oxlint-disable-next-line lfh/e2e-riegel` unterdrückt.
- Die Musterdateien liegen **nicht** unter dem echten `e2e/`, damit der normale Lint-Lauf sie nicht
  sieht.
- Er sieht auch die Fehler, die er verhindern soll: eine Plugin-API, die Selektoren nicht mehr
  auflöst, ergibt null Befunde → rot.
- Damit der Test überhaupt läuft und typgeprüft wird: `lint/**` in das `test.include` von
  `vite.config.ts` und das `include` von `tsconfig.json` aufnehmen. Heute nimmt Vitest nur
  `src/**` auf.

Die übrigen Riegel bekommen keinen Dauer-Test, sondern eine einmalige Mutationsprobe im PR
(Abnahme, Abschnitt 7): Select/Tag-Import samt `import * as antd`, `rules-of-hooks`,
`exhaustive-deps` als Warnung, die das Gate rot macht. Sie sind native oxlint-Regeln ohne
Alpha-Risiko.

### 4. Disable-Kommentare

Alle `eslint-disable-next-line …` werden mechanisch zu `oxlint-disable-next-line …`, mit den
oxlint-Regelnamen und dem bestehenden Begründungstext. Heute sind es 42: 38×
`react-hooks/exhaustive-deps`, 2× `no-restricted-imports`, 1× `no-restricted-syntax` → künftig
`lfh/e2e-riegel`, 1× `@typescript-eslint/no-explicit-any`. Grund (meine Wahl): nach dem Wechsel
wäre `eslint-disable` ein irreführender Name. Danach ist das Gate (mit
`--report-unused-disable-directives`, Abschnitt 1) grün, und ein Lauf mit allen Kommentaren
entfernt ergibt wieder genau die bekannten Stellen.

### 5. Guards auf oxc-parser

Betroffen:
- `src/api/apiTypScan.ts`, `src/api/queryKeyScan.ts`;
- `src/command-palette/schnellaktionen.guard.test.ts`;
- `src/components/{erreichbarkeit,erklaertext,datensicht,speicherfehler}.guard.test.ts`;
- `src/routing/rollGedaechtnis.guard.test.ts`;
- `src/pages/lagekarte/{leistenAbstand,kamera,zeichnungPraefix}.guard.test.ts`.

- **Ein gemeinsamer Helfer** `src/lib/quelltextAst.ts` (Name nach der Bezeichner-Regel; der
  Umsetzer darf ihn anpassen). Er bietet:
  - Parsen per `parseSync(dateiname, text)` aus `oxc-parser`; die Sprache folgt der Endung
    (`.ts`/`.tsx`).
  - Einen generischen Gang über alle Kindknoten (Visitor oder `visitorKeys`).
  - Offset → 1-basierte Zeile.
  - Den Text eines Knotens per `start`/`end`.

  Er ersetzt die je Datei wiederholten `createSourceFile` + `forEachChild`-Schleifen. Wie
  `queryKeyScan.ts` bleibt er ohne `import.meta.glob`: Er nimmt Quelltext entgegen, damit er nie
  ins App-Bundle gerät.
- **Gleichheitsprobe vor dem Umschreiben (Pflicht).**
  1. Solange `typescript` 6 noch installiert ist, läuft jeder Scanner und jede Guard-Prüffunktion
     einmal über alle Quelldateien, die sie heute lesen.
  2. Das Ergebnis (Funde mit Pfad, Zeile, Art/Prefix bzw. Treffer je Datei) wird als Datei im
     Scratchpad festgehalten.
  3. Die umgeschriebene Fassung muss über denselben Bestand **identische** Ergebnisse liefern;
     Abweichungen werden erklärt und behoben, nicht hingenommen.
  4. Dazu je Guard die bestehenden Selbstbeweise/Beispiele: sie müssen weiter greifen.

  So fällt ein still schwächerer Guard auf (Anti-Ziel 1).
- **Findet der neue Guard mehr** (echter Verstoß, den der TS-Parser übersah, etwa bei `a?.b()`
  als `ChainExpression` oder bei `.ts`-Dateien, die heute als TSX geparst werden), entschied der
  Mensch am 22.11.2026:
  - Ein bis drei Stellen werden im selben PR behoben, im Code oder als begründeter Eintrag in
    der Erlaubnisliste des Guards.
  - Sind es mehr, kommen sie vorerst in die Erlaubnisliste, und für den Abbau entsteht eine
    Zunder-Aufgabe.
  - Den Guard absichtlich blind zu bauen, damit er exakt das alte Ergebnis liefert, ist
    ausgeschlossen.
  - Jeder Mehrfund wird im PR unter „Geprüft“ genannt.
- Abbildung der Knotenarten ist Umsetzerarbeit. Bekannte Stolperstellen:
  - JSX-Text → `JSXText`.
  - Template-Teile → `TemplateLiteral.quasis` (`TemplateElement`, `value.cooked`).
  - String-Literale → `Literal` mit `typeof value === 'string'`.
  - `as`/`satisfies` → `TSAsExpression`/`TSSatisfiesExpression`.
  - `interface`/`type` → `TSInterfaceDeclaration`/`TSTypeAliasDeclaration`, Export über den
    umgebenden `ExportNamedDeclaration` statt `ExportKeyword`-Modifier.
  - Kurzform-Property → `Property.shorthand`.
  - Präfix-Minus → `UnaryExpression`.

### 6. Codegen über TS 6

- `devDependencies` bekommt `@typescript/typescript6` 6.0.2.
- Ein Hook `frontend/scripts/ts6-fuer-codegen.mjs` (`module.registerHooks`) lenkt nur
  Importe von `typescript` **aus openapi-typescript** auf `@typescript/typescript6`.
- `gen:types` wird zu
  `node --import ./scripts/ts6-fuer-codegen.mjs node_modules/openapi-typescript/bin/cli.js src/api/openapi.json -o src/api/types.generated.ts`
  (genauer Pfad der CLI-Datei prüft der Umsetzer). So bleibt die CLI samt Dateikopf.
- Abnahme: `scripts/check-typ-codegen.sh` grün und `git diff` auf `types.generated.ts` leer.
- Kopfkommentar im Hook: Er entfällt, sobald openapi-typescript TS 7 unterstützt; der Umsetzer
  legt dafür eine Zunder-Aufgabe an (`zunder-task-anlegen`).

### 7. TypeScript 7

- `typescript` auf 7.0.2 heben.
- `typecheck`/`build` rufen weiter `node_modules/typescript/bin/tsc`. Ob `--max-old-space-size`
  dort noch wirkt oder entfällt, weil der Go-Compiler den Node-Heap nicht braucht, prüft der
  Umsetzer; der Abschnitt „Heap für `tsc` (LLH-1405)“ in `frontend/AGENTS.md` wird entsprechend
  angepasst oder entfernt.
- Die zwei neuen TS2454-Fehler beheben:
  - `useSchnellaktionZaehler.test.tsx:34`, `useZuletztBefehle.test.tsx:55`: `gets` wird vor der
    Zuweisung benutzt.
  - Zu klären ist, wo `gets` deklariert ist und warum TS 7 strenger misst.
- `tsc -b` (im `build`) mit `tsconfig.node.json` prüfen. Mit TS 7 lief `tsc -b` ohne `--noEmit`
  am 22.11. bis auf diese Fehler durch.

### 8. Doku und Regeln, die mitgezogen werden

- `frontend/AGENTS.md`:
  - „Lint-Disziplin“: oxlint, `oxlint-disable-next-line` mit Begründung, Plugin und Probe-Test.
  - Verweise auf ESLint in den Abschnitten zu antd `Tag` (Zeilen ~691, ~1400).
  - Heap-Abschnitt (s. 7).
- `frontend/e2e/AGENTS.md`: die zwei Verweise auf `eslint.config.js`.
- `scripts/AGENTS.md`: Zeile zum Sammel-Gate (`pnpm lint`).
- `.devcontainer/devcontainer.json`: Die Empfehlung `dbaeumer.vscode-eslint` wird durch die
  oxc-Erweiterung ersetzt (`oxc.oxc-vscode`), damit die Meldungen im Editor erscheinen.
- `docs/architektur/02-randbedingungen.md`: „TypeScript 6“ → 7.
- `08-querschnittliche-konzepte.md`: Codegen-Kette nennt den TS-6-Hook.
- `11-risiken-und-technische-schulden.md`: zwei Einträge, die Alpha-API des Riegel-Plugins und der
  TS-6-Rest für den Codegen.
- Kommentare im Code, die auf `eslint.config.js` verweisen (z. B.
  `src/theme/statusVertrag.guard.test.ts`, `components/Select.tsx`, `components/SichtungsTag.tsx`),
  per `grep -rn eslint frontend/src frontend/e2e` nachziehen.
- **Neue ADR** (nächste freie Nummer auf `alpha`), etwa „Das Frontend lintet mit oxlint; eigene
  AST-Prüfungen lesen über oxc-parser“:
  - `gilt_fuer`: `frontend/.oxlintrc.json`, `frontend/lint/**`, `frontend/package.json`.
  - Regeln (MUST NOT `eslint` als Abhängigkeit, MUST NOT `from 'typescript'` in
    `frontend/src/**`, MUST Riegel im Plugin mit Probe-Test).
  - Prüfung per `verbiete`/`verlange`.
  - `herleitung`: dieses Dokument.

### 9. Reihenfolge (bestimmt durch die Abhängigkeiten)

1. Gleichheitsprobe aufnehmen (TS 6 noch da).
2. Guards und Scans auf oxc-parser, Gleichheit belegen.
3. oxlint + Plugin + Probe-Test, Kommentare umstellen, ESLint-Pakete und `eslint.config.js`
   entfernen.
4. Codegen-Hook.
5. `typescript` 7.0.2 und die Typfehler.
6. Doku, AGENTS.md, ADR.
7. `./scripts/check-all.sh --geaendert --ohne-e2e` und Mutationsproben.

Schritte 2 bis 4 sind voneinander unabhängig, aber alle vor 5.

## Dem Umsetzer überlassen

- Exakte Regelliste der `.oxlintrc.json` (aus `eslint --print-config` gegen `oxlint --rules`;
  Startpunkt im Vergleich unten).
- Name und Form des AST-Helfers, Visitor-Technik von oxc-parser.
- Aufbau der Musterdateien im Probe-Test.
- Ob `--max-old-space-size` bleibt.

## Abnahme

- `typescript` ≥ 7 in `frontend/package.json`, kein `eslint*`/`typescript-eslint` mehr.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` grün, `scripts/check-typ-codegen.sh` grün,
  `./scripts/check-all.sh --geaendert --ohne-e2e` grün.
- Gleichheitsprobe der Guards identisch.
- Mutationsprobe je Riegel im PR unter „Geprüft“ belegt:
  - eine tote Disable-Direktive macht `pnpm lint` rot;
  - Select, Tag und `import * as antd`;
  - `rules-of-hooks`;
  - eine `exhaustive-deps`-Warnung macht `pnpm lint` rot;
  - die vier e2e-Selektoren außerhalb und innerhalb der Ausnahmeliste.

## Herleitung

- Vergleich oxlint/Biome vom 22.11.2026 (Agent-Lauf, Configs und Proben im Scratchpad der
  Sitzung; Ergebnis am Zunder-Kommentar der Aufgabe).
- Messungen zu TS 7 und Codegen im selben Kommentar.
