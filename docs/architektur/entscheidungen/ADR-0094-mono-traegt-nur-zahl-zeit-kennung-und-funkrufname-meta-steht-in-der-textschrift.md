---
id: ADR-0094
titel: Mono trägt nur Zahl, Zeit, Kennung und Funkrufname; meta steht in der Textschrift
status: akzeptiert
datum: 2026-11-23
ersetzt: ADR-0087
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
  - Zunder LLH-2046 (Mono-Grenze allgemein, abgestimmt mit Ruben am 22.11.2026)
---

# ADR-0094: Mono trägt nur Zahl, Zeit, Kennung und Funkrufname; meta steht in der Textschrift

## Regeln

- MUST: Text bekommt Größe und Farbe aus einer Stufe der `schriftskala` und einem Ton
  (`Textstufe`, `schriftStil`); Regel: `frontend/AGENTS.md`, Gestaltungssprache, „`schriftskala`“.
- MUST NOT: Eine Stufe der `schriftskala` liegt unter `SCHRIFT_BODEN` (11 px).
- MUST NOT: Ein Schriftgrößen-Literal unter 11 px entsteht außerhalb von Druck, Zeichnungen mit
  eigenem Maßstab (Kartenstile, taktische Zeichen, Fernmeldeskizze, Lagekarten-Griffe, Cluster
  und die Legende ihrer Zeichen) und der Fernsicht des Lagemonitors.
- MUST: Mono trägt nur Zahl, Zeit, Kennung und Funkrufname; ein Wort, ein Satz oder ein
  gemischter Knoten steht in der Textschrift. Regel: `frontend/AGENTS.md`, Gestaltungssprache,
  „`schriftskala`“.
- MUST: `meta` steht in der Textschrift mit gleich breiten Ziffern (`ziffern: 'tabellarisch'`).
- MUST: Mono-Text nimmt seine Größe über `monoStil(stufe)` aus einer Stufe der Familie `zahl`
  (`monoFein` 11, `monoKlein` 12, `mono` 13, `monoGross` 14, `datenwert*`); eine Zahl nur aus einer
  Variablen.
- MUST NOT: `monoStil` bekommt eine Zahl als Literal (die Ratsche zählt sie wie `fontSize`).
- MUST NOT: Die Stufen der `schriftskala` hängen von der Bediendichte ab.
- MUST: Elemente reiht `Stapel` mit einer Rasterstufe; Formularfelder sind `Feld` mit einer
  Breitenstufe aus `FELDBREITE`; Regel: `frontend/AGENTS.md`, Gestaltungssprache, „Bausteine“.
- MUST NOT: `Textstufe`, `Stapel` und `Feld` nehmen ein `style`-Prop oder eine Zahl als Stufe an.
- MUST NOT: Die Schuld in `frontend/src/theme/schriftgroesse.schuld.ts` wächst oder wird länger.
- SHOULD: Wer eine Datei mit Schriftgrößen-Schuld anfasst, stellt ihre Größen auf Stufen um.

## Prüfung

```sh
verlange '^export const SCHRIFT_BODEN = 11;' frontend/src/theme/tokens.ts
verlange 'augenbraue: \{ groesse: 11, gewicht: 600' frontend/src/theme/tokens.ts
verlange 'seitentitel: \{ groesse: 16, gewicht: 600' frontend/src/theme/tokens.ts
verlange 'kartentitel: \{ groesse: 15, gewicht: 600' frontend/src/theme/tokens.ts
verlange '  mono: \{ groesse: 13, gewicht: 400' frontend/src/theme/tokens.ts
verbiete 'metaKlein' frontend/src/theme/tokens.ts frontend/src/theme/rollen.css
verlange "  meta: \\{ groesse: 11, gewicht: 400, familie: 'text', ziffern: 'tabellarisch' \\}" frontend/src/theme/tokens.ts
verlange "  monoFein: \\{ groesse: 11, gewicht: 400, familie: 'zahl' \\}" frontend/src/theme/tokens.ts
verbiete "monoStil\\('meta'" 'frontend/src/**/*.tsx'
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

ADR-0087 setzte `meta` in Mono; Unterzeilen wie „seit 14:32“ oder Namen standen damit in einer
Schrift für Ziffern. LLH-1714 nannte Wörter in Mono eine Lesehürde; abgestimmt am 22.11.2026: Mono
nur für Zahl, Zeit, Kennung und Funkrufname, in jeder Mono-Stufe.

## Konsequenzen

`meta` steht in Archivo mit `tabular-nums`, `monoFein` (11) trägt Zahlen in Meta-Größe. Die übrigen
Mono-Stufen sichtet ein zweiter Schritt; ein e2e-Wächter prüft dann, dass kein Wort in Mono steht.
