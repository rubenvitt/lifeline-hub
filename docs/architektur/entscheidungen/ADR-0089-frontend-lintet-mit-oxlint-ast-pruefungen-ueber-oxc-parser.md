---
id: ADR-0089
titel: Das Frontend lintet mit oxlint, eigene AST-Prüfungen lesen über oxc-parser, typgeprüft wird mit TypeScript 7
status: akzeptiert
datum: 2026-11-22
gilt_fuer:
  - frontend/.oxlintrc.json
  - frontend/lint/**
  - frontend/package.json
  - frontend/src/lib/sourceAst.ts
herleitung:
  - docs/superpowers/specs/2026-11-22-g2gwgpxa-oxlint-typescript-7-design.md
---

# ADR-0089: Das Frontend lintet mit oxlint, eigene AST-Prüfungen lesen über oxc-parser, typgeprüft wird mit TypeScript 7

## Regeln

- MUST NOT: kein ESLint und kein typescript-eslint im Frontend.
- MUST: Lint, Ausnahmen und eigene Riegel wie in `frontend/AGENTS.md`, „Frontend — Lint-Disziplin“
  (oxlint mit `--deny-warnings` und `--report-unused-disable-directives`, Plugin `lfh` mit
  Probe-Test).
- MUST NOT: Code unter `frontend/src/` lädt `typescript` (Import, `require`, `import()` oder
  Unterpfad); eigene AST-Prüfungen nutzen `frontend/src/lib/sourceAst.ts`.
- SHOULD: `@typescript/typescript6` nur für den Typ-Codegen (`frontend/scripts/ts6-fuer-codegen.mjs`).

## Prüfung

```sh
verbiete '"(eslint|typescript-eslint|@eslint/js|eslint-plugin-react-hooks)"' frontend/package.json
verlange '"lint": "oxlint --deny-warnings --report-unused-disable-directives"' frontend/package.json
verlange '"typescript": "\^7\.' frontend/package.json
verlange 'e2e-riegel' frontend/lint/riegel-plugin.js
verlange 'e2e-anmeldeformular' frontend/lint/riegel-plugin.test.ts
verbiete "(from|require\(|import\() *['\"]typescript(/[^'\"]*)?['\"]" 'frontend/src/**/*.ts' 'frontend/src/**/*.tsx'
```

## Kontext

TypeScript 7 (Go-Compiler) bringt die klassische Compiler-API nicht mehr mit. Daran hingen das
Lint-Gate (typescript-eslint verlangt `typescript <6.1`), 11 eigene AST-Prüfungen in Guard-Tests
und der Typ-Codegen. oxlint bildet das frühere ESLint-Set fast vollständig ab und meldet
`exhaustive-deps` an denselben Stellen; Biome wich in sechs Regeln und bei `exhaustive-deps` ab.

## Konsequenzen

Lint dauert unter einer Sekunde statt 40, der Typecheck rund 10 statt 60 Sekunden. Die
JS-Plugin-API von oxlint ist Alpha, deshalb trägt jeder eigene Riegel Musterdateien. Der
Typ-Codegen hängt bis zum Rückbau (LLH-2068) an einem auslaufenden TS-6-Paket.
