---
id: ADR-0071
titel: Text, Mono, Abstand und Feldbreite kommen aus benannten Stufen, die Bausteine nehmen keine Zahl an
status: ersetzt
datum: 2026-11-19
ersetzt: ADR-0065
ersetzt_durch: ADR-0087
gilt_fuer:
  - frontend/src/theme/tokens.ts
  - frontend/src/theme/rollen.css
  - frontend/src/theme/schriftgroesse.guard.test.ts
  - frontend/src/theme/schriftgroesse.schuld.ts
  - frontend/src/components/feld.guard.test.ts
  - frontend/src/components/instrument/rollenwerte.ts
  - frontend/src/components/instrument/Textstufe.tsx
  - frontend/src/components/instrument/Stapel.tsx
  - frontend/src/components/instrument/MetaZeile.tsx
  - frontend/src/components/instrument/Feld.tsx
  - frontend/src/**/*.tsx
herleitung:
  - docs/superpowers/specs/2026-11-19-ldu5dmkb-mono-stufen-design.md
  - openspec/changes/archive/2026-11-18-hzru8iq7-text-stapel-meta-feld/design.md
  - Zunder LLH-1972 (Mono-Stufen und 13 px abgestimmt mit Ruben am 19.11.2026)
---

# ADR-0071: Text, Mono, Abstand und Feldbreite kommen aus benannten Stufen, die Bausteine nehmen keine Zahl an

## Regeln

- MUST: Text bekommt Größe und Farbe aus einer Stufe der `schriftskala` und einem Ton
  (`Textstufe`, `schriftStil`); Regel: `frontend/AGENTS.md`, Gestaltungssprache, „`schriftskala`“.
- MUST: Mono-Text nimmt seine Größe über `monoStil(stufe)` aus einer Stufe der Familie `zahl`
  (`metaKlein` 10, `meta` 11, `monoKlein` 12, `mono` 13, `monoGross` 14, `datenwert*`); eine Zahl
  nur aus einer Variablen.
- MUST NOT: `monoStil` bekommt eine Zahl als Literal (die Ratsche zählt sie wie `fontSize`).
- MUST NOT: Die Stufen der `schriftskala` hängen von der Bediendichte ab.
- MUST: Elemente reiht `Stapel` mit einer Rasterstufe; Formularfelder sind `Feld` mit einer
  Breitenstufe aus `FELDBREITE`; Regel: `frontend/AGENTS.md`, Gestaltungssprache, „Bausteine“.
- MUST NOT: `Textstufe`, `Stapel` und `Feld` nehmen ein `style`-Prop oder eine Zahl als Stufe an.
- MUST NOT: Die Schuld in `frontend/src/theme/schriftgroesse.schuld.ts` wächst oder bekommt einen
  neuen Eintrag; einzige Ausnahme war die Einbuchung der Mono-Ausreißer am 19.11.2026.
- SHOULD: Wer eine Datei mit Schriftgrößen-Schuld anfasst, stellt ihre Größen auf Stufen um.

## Prüfung

```sh
verlange 'kartentitel: \{ groesse: 15, gewicht: 600' frontend/src/theme/tokens.ts
verlange '  mono: \{ groesse: 13, gewicht: 400' frontend/src/theme/tokens.ts
verlange '^export const FELDBREITE' frontend/src/theme/tokens.ts
verlange 'groesse: Monostufe \| number' frontend/src/components/instrument/rollenwerte.ts
verlange 'MONO_ZAHL' frontend/src/theme/schriftgroesse.guard.test.ts
verlange "Omit<FormItemProps<Values>, 'style'>" frontend/src/components/instrument/Feld.tsx
verbiete '^  style\??:' frontend/src/components/instrument/Textstufe.tsx frontend/src/components/instrument/Stapel.tsx
verbiete 'useDichte|dichten\[' frontend/src/components/instrument/Textstufe.tsx
test -f frontend/src/components/feld.guard.test.ts
```

## Kontext

ADR-0065 band Text, Abstand und Feldbreite an Stufen, ließ `monoStil(<Zahl>)` aber frei: rund
400 Mono-Aufrufe mit Größen von 8 bis 40 px standen neben der Skala. Die Größen 10 bis 14 trugen
fast alle davon, 13 px war die zweithäufigste.

## Konsequenzen

Mono bekommt fünf Stufen von 10 bis 14 px, die den Bestand pixelgleich abbilden; 13 px gibt es
nur als Mono-Stufe, weil JetBrains Mono 13 optisch neben Archivo 14 steht. Die übrigen
Mono-Größen stehen als Schuld fest und sinken wie die übrigen Schriftgrößen-Literale.
