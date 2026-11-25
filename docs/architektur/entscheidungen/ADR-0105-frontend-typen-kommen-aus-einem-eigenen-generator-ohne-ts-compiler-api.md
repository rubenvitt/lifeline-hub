---
id: ADR-0105
titel: Antworttypen kommen per eigenem Generator ohne TS-Compiler-API aus dem Rust-Code
status: akzeptiert
datum: 2026-11-25
ersetzt: ADR-0004
gilt_fuer:
  - src/api_doc.rs
  - frontend/src/api/**
  - frontend/scripts/gen-types.mjs
  - frontend/package.json
  - scripts/check-typ-codegen.sh
  - crates/karten-katalog/**
herleitung:
  - docs/superpowers/specs/2026-11-25-vg8wd2yg-eigener-typ-generator-design.md
  - docs/superpowers/plans/2026-07-08-lfh120-typ-codegen.md
---

# ADR-0105: Antworttypen kommen per eigenem Generator ohne TS-Compiler-API aus dem Rust-Code

## Regeln

- MUST: Die Kette `#[derive(ToSchema)]` → `src/api_doc.rs` → `frontend/src/api/openapi.json` →
  `frontend/scripts/gen-types.mjs` → `frontend/src/api/types.generated.ts` ist die einzige Quelle
  der Antworttypen im Frontend; Einzelheiten: `src/AGENTS.md`, „Backend↔Frontend — Typ-Codegen“.
- MUST NOT: Antwortformen im Frontend von Hand beschreiben; `frontend/src/api/types.ts` ist
  nur Barrel über die generierten Schemas. Erlaubte Handtypen regelt
  `frontend/src/api/apiResponseTypen.guard.test.ts`.
- MUST: Beide generierten Dateien sind versioniert und werden nach jeder Änderung an einem
  Antwort-DTO oder Enum mitcommittet (Wurzel-`AGENTS.md`, „Qualitäts-Gates“).
- MUST NOT: kein fremder Generator oder Client-Generator (openapi-typescript, orval,
  openapi-generator, swagger-typescript-api, @hey-api/openapi-ts) und keine Abhängigkeit von der
  Compiler-API von TypeScript im Codegen.
- MUST: Ein Schema-Konstrukt, das `gen-types.mjs` nicht kennt, bricht den Lauf mit Pfad ab; neue
  Formen kommen mit einem Fall in `frontend/src/api/genTypes.test.ts`.
- SHOULD: Typen, die Server und Karten-Service teilen, liegen in `crates/karten-katalog`,
  dort mit `ToSchema` hinter dem Feature `schema`.

## Prüfung

```sh
test -x scripts/check-typ-codegen.sh
verlange 'check-typ-codegen\.sh' scripts/check-all.sh
verlange '^utoipa = ' Cargo.toml
verlange '"gen:types": "node scripts/gen-types\.mjs ' frontend/package.json
verbiete '"(openapi-typescript|orval|@openapitools/openapi-generator-cli|swagger-typescript-api|openapi-zod-client|@hey-api/openapi-ts|@typescript/typescript6)":' frontend/package.json
verbiete "from ['\"]typescript['\"]|require\(['\"]typescript['\"]\)" frontend/scripts/gen-types.mjs
verlange 'class GenTypesError' frontend/scripts/gen-types.mjs
verlange 'erzeugt die committete types\.generated\.ts' frontend/src/api/genTypes.test.ts
verlange "from './types\.generated'" frontend/src/api/types.ts
test "$(git ls-files frontend/src/api/openapi.json frontend/src/api/types.generated.ts | wc -l | tr -d ' ')" = 2
verlange 'REQUEST_DTO_KONVENTION' frontend/src/api/apiResponseTypen.guard.test.ts
```

## Kontext

ADR-0004 band den Codegen an openapi-typescript. Seit TypeScript 7 (LLH-2020) fehlt dessen
Compiler-API, und openapi-typescript lief nur noch über einen Resolve-Hook auf dem auslaufenden
`@typescript/typescript6`. Das Projekt wird nur noch verwaltet, eine Unterstützung für TS 7 ist
nicht absehbar (Prüfung 25.11.2026, LLH-2068). `openapi.json` trägt nur Schemas mit rund zehn
Konstrukten, ein eigener Generator ist daher klein.

## Konsequenzen

Der Codegen hängt an keinem Fremdprojekt mehr, und `types.generated.ts` blieb Byte für Byte
gleich (bis auf den Kopf). Neue Formen aus utoipa pflegen wir selbst; der laute Abbruch macht sie
im Gate sichtbar. Request-DTOs und die drei `Record<>`-Maps bleiben wie unter ADR-0004
handgepflegt.
