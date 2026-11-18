---
id: ADR-0065
titel: Text, Abstand und Feldbreite kommen aus benannten Stufen, die Bausteine nehmen keine Zahl an
status: akzeptiert
datum: 2026-11-18
gilt_fuer:
  - frontend/src/theme/tokens.ts
  - frontend/src/theme/schriftgroesse.guard.test.ts
  - frontend/src/theme/schriftgroesse.schuld.ts
  - frontend/src/components/feld.guard.test.ts
  - frontend/src/components/instrument/Textstufe.tsx
  - frontend/src/components/instrument/Stapel.tsx
  - frontend/src/components/instrument/MetaZeile.tsx
  - frontend/src/components/instrument/Feld.tsx
  - frontend/src/**/*.tsx
herleitung:
  - openspec/changes/archive/2026-11-18-hzru8iq7-text-stapel-meta-feld/design.md
  - Zunder LLH-1810 (Skala, Dichte, Feldform und Umfang abgestimmt mit Ruben am 18.11.2026)
---

# ADR-0065: Text, Abstand und Feldbreite kommen aus benannten Stufen, die Bausteine nehmen keine Zahl an

## Regeln

- MUST: Text bekommt Größe und Farbe aus einer Stufe der `schriftskala` und einem Ton
  (`Textstufe`, `schriftStil`); Regel: `frontend/AGENTS.md`, Gestaltungssprache, „`schriftskala`“.
- MUST NOT: Die Stufen der `schriftskala` hängen von der Bediendichte ab.
- MUST: Elemente reiht `Stapel` mit einer Rasterstufe; Formularfelder sind `Feld` mit einer
  Breitenstufe aus `FELDBREITE`; Regel: `frontend/AGENTS.md`, Gestaltungssprache, „Bausteine“.
- MUST NOT: `Textstufe`, `Stapel` und `Feld` nehmen ein `style`-Prop oder eine Zahl als Stufe an.
- MUST NOT: Die Schuld in `frontend/src/theme/schriftgroesse.schuld.ts` wächst oder bekommt einen
  neuen Eintrag.
- SHOULD: Wer eine Datei mit Schriftgrößen-Schuld anfasst, stellt ihre Größen auf Stufen um.

## Prüfung

```sh
verlange 'kartentitel: \{ groesse: 15, gewicht: 600' frontend/src/theme/tokens.ts
verlange '^export const FELDBREITE' frontend/src/theme/tokens.ts
verlange "Omit<FormItemProps<Values>, 'style'>" frontend/src/components/instrument/Feld.tsx
verbiete '^  style\??:' frontend/src/components/instrument/Textstufe.tsx frontend/src/components/instrument/Stapel.tsx
verbiete 'useDichte|dichten\[' frontend/src/components/instrument/Textstufe.tsx
test -f frontend/src/theme/schriftgroesse.guard.test.ts
test -f frontend/src/components/feld.guard.test.ts
```

## Kontext

Schriftgröße, Abstand und Feldbreite standen an jeder Stelle als Inline-Stil, 13 und 15 px ohne
Stufe in der Skala. Wächter fingen feste Feldbreiten erst nachträglich und nur in ihrer Zahlform;
eine neue Seite richtig zu bauen hieß, viel Regeltext zu kennen.

## Konsequenzen

Die richtige Form ist die einfachste: Die Bausteine lassen nur erlaubte Werte zu, ihre Typen
fangen den Rest. Der Verwaltungsteil ist umgestellt, der Feld-Wächter verlangt dort `Feld`. Die
übrigen Bereiche folgen als eigene Aufgaben; bis dahin halten Schuld-Listen den Bestand fest.
`monoStil(<Zahl>)` und Knopfreihen sind noch frei und brauchen eigene Stufen.
