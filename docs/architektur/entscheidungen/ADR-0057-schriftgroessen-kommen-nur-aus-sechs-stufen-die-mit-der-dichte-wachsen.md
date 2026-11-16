---
id: ADR-0057
titel: Schriftgrößen kommen nur aus sechs Stufen, die mit der Dichte wachsen
status: akzeptiert
datum: 2026-11-15
gilt_fuer:
  - frontend/src/theme/tokens.ts
  - frontend/src/theme/rollen.css
  - frontend/src/components/instrument/rollenwerte.ts
  - frontend/src/**/*.tsx
  - frontend/index.html
herleitung:
  - openspec/changes/archive/2026-11-16-i1o47voj-schrift-lesbarkeit/design.md
  - Zunder LLH-1719 (Stufen, Zoom, Feldetikett und Mono-Grenze abgestimmt mit Ruben am 15.11.2026)
---

# ADR-0057: Schriftgrößen kommen nur aus sechs Stufen, die mit der Dichte wachsen

## Regeln

- MUST: Jede Schriftgröße am Schirm ist eine der `groessenstufen` (`frontend/src/theme/tokens.ts`),
  gesetzt über `schriftGroesse`, `schriftStil`, `zahlStil`, den Baustein `Schrift`, antds
  `token.fontSize*` oder `var(--lfh-groesse-…)`/`var(--lfh-typo-…)`; Regel und Ausnahmen:
  `frontend/AGENTS.md`, Gestaltungssprache, „Schrift: sechs Stufen, Rollen darüber“.
- MUST NOT: Eine Schriftgröße steht als Zahl oder Pixelwert außerhalb des Themes (Wächter
  `frontend/src/theme/schriftLiteral.guard.test.ts`, ohne Schuldmenge).
- MUST: Die Stufen bis `titel` wachsen über `--lfh-schrift-faktor` mit der Bediendichte; die
  Datenwerte stehen fest.
- MUST NOT: Der Viewport sperrt den Zoom (`maximum-scale`, `user-scalable=no`).
- MUST: Mono trägt nur Zahl, Zeit, Kennung und Funkrufname; Feldetiketten stehen gemischt
  geschrieben (`frontend/AGENTS.md`, „Mono nur für …“ und „Versalien nur in Köpfen …“).

## Prüfung

```sh
verlange 'fein: 11,' frontend/src/theme/tokens.ts
verlange '^  --lfh-schrift-faktor: 1\.25;' frontend/src/theme/rollen.css
verbiete 'monoStil\(' 'frontend/src/**/*.ts' 'frontend/src/**/*.tsx' ':!frontend/src/theme/schriftLiteral.guard.test.ts'
verbiete 'maximum-scale|user-scalable=no' frontend/index.html
verlange 'kein Größen-Literal' frontend/src/theme/schriftLiteral.guard.test.ts
```

## Kontext

Die Messung vom 12.11.2026 (LLH-1714) fand 14 gerenderte Größen, 26,7 % der Zeichen am Fükw unter
12 px und einen Anteil, der mit der Dichte stieg, weil nur antds Grundschrift mitwuchs; der Zoom
war gesperrt. Rund 240 Größen-Literale standen neben 31 Verweisen auf die Skala. Verworfen wurden
eine rem-Skala (antd rechnet in Pixeln) und eine ESLint-Regel (rot geboren, liest kein CSS).

## Konsequenzen

Eine neue Komponente wählt eine Stufe statt einer Zahl; der Wächter macht jede Zahl rot.
`komfortabel` und `handschuh` vergrößern die Schrift überall, Layouts müssen das tragen. Die
Regel „Kein Zoom wie in einer App“ (LLH-1328) ist aufgehoben; den iOS-Fokus-Zoom fängt die
Feldgröße von 16,1 px in `komfortabel` ab.
