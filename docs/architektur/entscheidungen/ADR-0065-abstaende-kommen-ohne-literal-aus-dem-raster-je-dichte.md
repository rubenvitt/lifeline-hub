---
id: ADR-0065
titel: Abstände kommen ohne Literal aus dem Raster je Dichte
status: akzeptiert
datum: 2026-11-18
ersetzt: ADR-0059
gilt_fuer:
  - frontend/src/theme/tokens.ts
  - frontend/src/theme/rollen.css
  - frontend/src/theme/abstandsraster.guard.test.ts
  - frontend/src/**/*.tsx
herleitung:
  - openspec/changes/archive/2026-11-17-m113c8ln-abstandsraster/design.md
  - openspec/changes/archive/2026-11-18-t12gr9tu-abstandsraster-nulltoleranz/design.md
  - Zunder LLH-1937 (Wächter bleibt als Nulltoleranz, abgestimmt mit Ruben am 18.11.2026)
---

# ADR-0065: Abstände kommen ohne Literal aus dem Raster je Dichte

## Regeln

- MUST: Innen- und Außenabstände und Lücken kommen aus `dichten[*].abstand` der aktiven Dichte,
  in TSX über die antd-Tokens, in CSS über `var(--lfh-luft-*)`; Regel: `frontend/AGENTS.md`,
  Gestaltungssprache, „Abstandsraster“.
- MUST: Jedes antd-Abstandstoken von XXS bis XL steht in `antdToken()` auf einer Stufe des Rasters.
- MUST NOT: Ein Abstandsraster, das unabhängig von der Dichte auf `kompakt` festsitzt, wird
  exportiert.
- MUST: `frontend/src/theme/abstandsraster.guard.test.ts` bleibt und duldet kein Abstands-Literal
  über 2 px außerhalb von `AUSNAHMEN`.
- MUST NOT: Eine Schuld- oder Duldungsliste für Abstands-Literale neben `AUSNAHMEN` entsteht.

## Prüfung

```sh
verbiete '^export const abstand\b' frontend/src/theme/tokens.ts
verlange 'paddingXXS: stufe\.abstand\.xxs' frontend/src/theme/tokens.ts
verlange 'paddingMD: stufe\.abstand\.lg' frontend/src/theme/tokens.ts
verlange 'marginXL: stufe\.abstand\.xl' frontend/src/theme/tokens.ts
verlange '--lfh-luft-5' frontend/src/theme/rollen.css
test -f frontend/src/theme/abstandsraster.guard.test.ts
test ! -e frontend/src/theme/abstandsraster.schuld.ts
verbiete 'SCHULD' frontend/src/theme/abstandsraster.guard.test.ts
```

## Kontext

ADR-0059 führte das Raster ein und einen Ratschen-Wächter, der die Altlast von rund 400 Literalen
je Datei festhielt und mit ihr wegfallen sollte. Mit LLH-1937 ist die Altlast abgebaut. Ohne
Wächter stünde die Spec-Regel „Abstände ohne Literal“ ohne Prüfung.

## Konsequenzen

Der Wächter bleibt als Nulltoleranz und meldet jedes Literal mit Datei, Zeile und Wert; die
Schuldliste ist gelöscht. Werte aus Variablen oder Rechnungen sieht er weiterhin nicht
(Kapitel 11, R43). Die Raster-Regeln und -Werte von ADR-0059 gelten unverändert weiter.
