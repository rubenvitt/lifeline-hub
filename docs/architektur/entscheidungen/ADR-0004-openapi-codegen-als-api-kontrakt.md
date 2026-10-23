---
id: ADR-0004
titel: Antworttypen kommen per Codegen aus dem Rust-Code (OpenAPI nach TypeScript)
status: akzeptiert
datum: 2026-07-08
gilt_fuer:
  - src/api_doc.rs
  - frontend/src/api/**
  - scripts/check-typ-codegen.sh
  - crates/karten-katalog/**
herleitung:
  - docs/superpowers/plans/2026-07-08-lfh120-typ-codegen.md
  - docs/superpowers/plans/2026-07-08-lfh120-orphan-union-mapping.md
---

# ADR-0004: Antworttypen kommen per Codegen aus dem Rust-Code (OpenAPI nach TypeScript)

## Regeln

- MUST: Die Kette `#[derive(ToSchema)]` → `src/api_doc.rs` → `frontend/src/api/openapi.json` →
  `openapi-typescript` → `frontend/src/api/types.generated.ts` ist die einzige Quelle der
  Antworttypen im Frontend; Einzelheiten: `src/AGENTS.md`, „Backend↔Frontend — Typ-Codegen“.
- MUST NOT: Antwortformen im Frontend von Hand beschreiben; `frontend/src/api/types.ts` ist
  nur Barrel über die generierten Schemas. Erlaubte Handtypen regelt
  `frontend/src/api/apiResponseTypen.guard.test.ts`.
- MUST: Beide generierten Dateien sind versioniert und werden nach jeder Änderung an einem
  Antwort-DTO oder Enum mitcommittet (Wurzel-`AGENTS.md`, „Qualitäts-Gates“).
- MUST NOT: kein zweiter Generator oder Client-Generator (orval, openapi-generator,
  swagger-typescript-api) neben `openapi-typescript`.
- SHOULD: Typen, die Server und Karten-Service teilen, liegen in `crates/karten-katalog`,
  dort mit `ToSchema` hinter dem Feature `schema`.

## Prüfung

```sh
test -x scripts/check-typ-codegen.sh
verlange 'check-typ-codegen\.sh' scripts/check-all.sh
verlange '^utoipa = ' Cargo.toml
verlange '"openapi-typescript":' frontend/package.json
verbiete '"(orval|@openapitools/openapi-generator-cli|swagger-typescript-api|openapi-zod-client)":' frontend/package.json
verlange "from './types\.generated'" frontend/src/api/types.ts
test "$(git ls-files frontend/src/api/openapi.json frontend/src/api/types.generated.ts | wc -l | tr -d ' ')" = 2
verlange 'REQUEST_DTO_KONVENTION' frontend/src/api/apiResponseTypen.guard.test.ts
```

## Kontext

Vor LFH-120 pflegte das Frontend Spiegel der Rust-Antworten von Hand; sie drifteten still, ein
Feld fehlte erst zur Laufzeit. Der Review vom 11.07.2026 fand dieselbe Lücke noch in der
Kartendomäne (F11). Der Codegen macht den Rust-Typ zur Wahrheit und eine Abweichung zum
Typfehler im Frontend-Build.

## Konsequenzen

Eine Änderung an einer Antwort fällt im Frontend sofort auf (Typecheck, Drift-Gate in
`scripts/check-all.sh`). Request-DTOs (`NeuerX`, `PatchX`) und drei `Record<>`-Maps bleiben
handgepflegt und damit ohne diesen Schutz. Jeder DTO-Commit trägt zwei große generierte Dateien
mit.
