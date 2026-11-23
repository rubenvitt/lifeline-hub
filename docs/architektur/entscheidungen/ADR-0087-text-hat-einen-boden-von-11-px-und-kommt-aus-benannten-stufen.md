---
id: ADR-0087
titel: Text hat einen Boden von 11 px und kommt wie Mono, Abstand und Feldbreite aus benannten Stufen
status: ersetzt
datum: 2026-11-23
ersetzt: ADR-0071
ersetzt_durch: ADR-0094
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
  - docs/superpowers/specs/2026-11-22-ergjsurw-schrift-lesbarkeit-design.md
  - docs/superpowers/specs/2026-11-19-ldu5dmkb-mono-stufen-design.md
  - Zunder LLH-2044 (Boden 11 px, Seitentitel 16, Rail 64 abgestimmt mit Ruben am 22.11.2026)
---

# ADR-0087: Text hat einen Boden von 11 px und kommt wie Mono, Abstand und Feldbreite aus benannten Stufen

## Regeln

- MUST: Text bekommt Größe und Farbe aus einer Stufe der `schriftskala` und einem Ton
  (`Textstufe`, `schriftStil`); Regel: `frontend/AGENTS.md`, Gestaltungssprache, „`schriftskala`“.
- MUST NOT: Eine Stufe der `schriftskala` liegt unter `SCHRIFT_BODEN` (11 px).
- MUST NOT: Ein Schriftgrößen-Literal unter 11 px entsteht außerhalb von Druck, Zeichnungen mit
  eigenem Maßstab (Kartenstile, taktische Zeichen, Fernmeldeskizze, Lagekarten-Griffe, Cluster
  und die Legende ihrer Zeichen) und der Fernsicht des Lagemonitors.
- MUST: Mono-Text nimmt seine Größe über `monoStil(stufe)` aus einer Stufe der Familie `zahl`
  (`meta` 11, `monoKlein` 12, `mono` 13, `monoGross` 14, `datenwert*`); eine Zahl nur aus einer
  Variablen.
- MUST NOT: `monoStil` bekommt eine Zahl als Literal (die Ratsche zählt sie wie `fontSize`).
- MUST NOT: Die Stufen der `schriftskala` hängen von der Bediendichte ab.
- MUST: Elemente reiht `Stapel` mit einer Rasterstufe; Formularfelder sind `Feld` mit einer
  Breitenstufe aus `FELDBREITE`; Regel: `frontend/AGENTS.md`, Gestaltungssprache, „Bausteine“.
- MUST NOT: `Textstufe`, `Stapel` und `Feld` nehmen ein `style`-Prop oder eine Zahl als Stufe an.
- MUST NOT: Die Schuld in `frontend/src/theme/schriftgroesse.schuld.ts` wächst oder bekommt einen
  neuen Eintrag.
- SHOULD: Wer eine Datei mit Schriftgrößen-Schuld anfasst, stellt ihre Größen auf Stufen um.

## Prüfung

```sh
verlange '^export const SCHRIFT_BODEN = 11;' frontend/src/theme/tokens.ts
verlange 'augenbraue: \{ groesse: 11, gewicht: 600' frontend/src/theme/tokens.ts
verlange 'seitentitel: \{ groesse: 16, gewicht: 600' frontend/src/theme/tokens.ts
verlange 'kartentitel: \{ groesse: 15, gewicht: 600' frontend/src/theme/tokens.ts
verlange '  mono: \{ groesse: 13, gewicht: 400' frontend/src/theme/tokens.ts
verbiete 'metaKlein' frontend/src/theme/tokens.ts frontend/src/theme/rollen.css
verlange 'SCHRIFT_BODEN' frontend/src/theme/rollen.guard.test.ts
verlange '^export const FELDBREITE' frontend/src/theme/tokens.ts
verlange 'groesse: Monostufe \| number' frontend/src/components/instrument/rollenwerte.ts
verlange 'MONO_ZAHL' frontend/src/theme/schriftgroesse.guard.test.ts
verlange "Omit<FormItemProps<Values>, 'style'>" frontend/src/components/instrument/Feld.tsx
verbiete '^  style\??:' frontend/src/components/instrument/Textstufe.tsx frontend/src/components/instrument/Stapel.tsx
verbiete 'useDichte|dichten\[' frontend/src/components/instrument/Textstufe.tsx
test -f frontend/src/components/feld.guard.test.ts
```

## Kontext

ADR-0071 legte Text, Mono, Abstand und Feldbreite auf Stufen, ließ aber Stufen von 9 und 10 px
zu: Augenbraue, Rail-Etikett und kleine Mono-Meta. Die UI/UX-Analyse LLH-1714 fand ein Viertel bis
ein Drittel der Zeichen unter 12 px. Der Neuanlauf von LLH-1719 hebt den Boden ohne Kopplung an die
Dichte (ADR-0071 hält das fest, diese ADR übernimmt es).

## Konsequenzen

Augenbraue und Rail-Etikett stehen auf 11 px mit geringerer Sperrung, die Rail ist 64 px breit,
`metaKlein` entfällt zugunsten von `meta`; der Seitentitel steht mit 16 px über dem Lauftext.
Unter 11 px bleiben nur die genannten Nicht-Ziele, als Schuld oder außerhalb der Ratsche.
