---
id: ADR-0059
titel: Abstände kommen aus einem Raster je Dichte auf Vielfachen von 4
status: ersetzt
ersetzt_durch: ADR-0066
datum: 2026-11-16
gilt_fuer:
  - frontend/src/theme/tokens.ts
  - frontend/src/theme/rollen.css
  - frontend/src/theme/abstandsraster.guard.test.ts
  - frontend/src/**/*.tsx
herleitung:
  - openspec/changes/archive/2026-11-17-m113c8ln-abstandsraster/design.md
  - Zunder LLH-1809 (Variante „auf 4er runden“ und Ratschen-Wächter abgestimmt mit Ruben am 16.11.2026)
---

# ADR-0059: Abstände kommen aus einem Raster je Dichte auf Vielfachen von 4

## Regeln

- MUST: Innen- und Außenabstände und Lücken kommen aus `dichten[*].abstand` der aktiven Dichte,
  in TSX über die antd-Tokens, in CSS über `var(--lfh-luft-*)`; Regel: `frontend/AGENTS.md`,
  Gestaltungssprache, „Abstandsraster“.
- MUST: Jedes antd-Abstandstoken von XXS bis XL steht in `antdToken()` auf einer Stufe des Rasters.
- MUST NOT: Ein Abstandsraster, das unabhängig von der Dichte auf `kompakt` festsitzt, wird
  exportiert.
- MUST NOT: Die Schuld in `frontend/src/theme/abstandsraster.schuld.ts` wächst oder bekommt einen
  neuen Eintrag.
- SHOULD: Wer eine Datei mit Schuld anfasst, stellt ihre Literale auf das Raster um.

## Prüfung

```sh
verbiete '^export const abstand\b' frontend/src/theme/tokens.ts
verlange 'paddingXXS: stufe\.abstand\.xxs' frontend/src/theme/tokens.ts
verlange 'paddingMD: stufe\.abstand\.lg' frontend/src/theme/tokens.ts
verlange 'marginXL: stufe\.abstand\.xl' frontend/src/theme/tokens.ts
verlange '--lfh-luft-5' frontend/src/theme/rollen.css
test -f frontend/src/theme/abstandsraster.guard.test.ts
```

## Kontext

Neben der Dichte-Staffel 3/7/11/18 standen antds feste Vorgaben für XXS, MD und XL, ein fester
Kompakt-Export `abstand` und rund 300 rohe Pixel-Literale. Abstände wuchsen deshalb in
`komfortabel` und `handschuh` nur zum Teil mit, und jede Seite konnte eigene Werte setzen.

## Konsequenzen

Ein Raster je Dichte auf Vielfachen von 4 trägt alle Abstände; die Literale 8/12/16 ziehen in
`kompakt` ohne sichtbare Änderung um und wachsen in den anderen Stufen mit. Alle Token-Abstände
verschieben sich einmalig um 1 bis 2 px. Ein Ratschen-Wächter hält die Altlast fest, bis die
Folgeaufgaben je Bereich sie auf null bringen; dann fällt er weg.
