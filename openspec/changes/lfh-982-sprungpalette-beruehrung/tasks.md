# Tasks

## 1. Weiche und Schließknopf (D1, D2, D6)

- [ ] 1.1 `zeilenStil.test.ts`: `schliessKnopfMass` liefert 48 bei `controlHeight` 30 und 48, 72 bei 72 (Böden als Literale). Prüfen: rot vor 1.2
- [ ] 1.2 `zeilenStil.ts`: `schliessKnopfMass(token)` = `Math.max(48, token.controlHeight)`. Prüfen: 1.1 grün
- [ ] 1.3 `CommandPalette.test.tsx`, Block „Zeigerart (LFH-982)“: bei `setzeZeigerGrob(true)` steht der Knopf „Sprungpalette schließen“ und ein Klick ruft `schliesse`, keine Esc-Marke im Kopf; Gegenfall feiner Zeiger: Esc-Marke, kein Knopf; Zeigerwechsel bei offener Palette (`sendeZeigerAenderung`) schaltet um. Prüfen: rot vor 1.4
- [ ] 1.4 `CommandPalette.tsx`: `istBeruehrung` aus `useViewport()`, Schließknopf (`Button type="text"`, `IconKreuz`, Maß aus 1.2) statt Esc-Marke bei grobem Zeiger. Prüfen: 1.3 grün

## 2. Tastenhinweise ausblenden (D3)

- [ ] 2.1 Tests: bei grobem Zeiger keine Marken ↵, `Strg ↵`/`⌘ ↵`, →, Esc in der Fußzeile, keine `b.kuerzel`-Marke an einer Aktionszeile, keine ↵-Marke an der aktiven Zeile, Vorschau-Ziel mit `title` „Vorschau“, Live-Region in der Vorschau ohne „Escape“; Gegenfall feiner Zeiger wie bisher. Prüfen: rot vor 2.2
- [ ] 2.2 `CommandPalette.tsx`: Fußzeile, `optionsZeile` und Live-Region nach `istBeruehrung`. Prüfen: 2.1 grün, bestehende Palette-Tests grün

## 3. Präfix-Chips und „Öffnen“ (D4, D5)

- [ ] 3.1 Tests: Chip „>“ setzt „>“ vor den Begriff und das Suchfeld hat den Fokus; Chip „#“ ersetzt „>spei“ durch „#spei“; gedrückter Chip (`aria-pressed`) nimmt das Präfix weg; `title` = Legende; in der Vorschau ruft „Öffnen“ den Befehl aus und schließt. Prüfen: rot vor 3.2
- [ ] 3.2 `CommandPalette.tsx`: Chips aus `modiMitPraefix()` als `Button`, `onMouseDown` mit `preventDefault`, einzeilig; „Öffnen“ (`type="primary"`) in der Vorschau-Fußzeile. Prüfen: 3.1 grün
- [ ] 3.3 Mutationsprobe: `istBeruehrung` fest auf `false` macht den Touch-Block rot, fest auf `true` den Gegenfall. Ergebnis hier notieren

## 4. Regeln

- [ ] 4.1 Kommentar über der Fußzeile und Dateikopf-Hinweis in `CommandPalette.tsx` nach Zeigerart; Regel „Zeigerart“ in `frontend/src/command-palette/AGENTS.md` (Weiche am primären Zeiger, Schließknopf, keine Tastenhinweise, Chips, „Öffnen“). Prüfen: `scripts/check-fmt.sh` bzw. Prettier über `frontend/` grün

## 5. Browser-Nachweis (D7)

- [ ] 5.1 `e2e/command-palette.spec.ts`, `hasTouch` bei 390 × 844 und 820 × 1180: Schließknopf antippen schließt, Maß ≥ 48 in Höhe und Breite, keine Tastenmarken in der Fußzeile, Fußzeile ≤ 70 px, Chip „@“ antippen setzt das Präfix; einmal als Admin, einmal als Beobachter (`e2e/rollen-kern.ts`). Mutationsprobe dokumentieren
- [ ] 5.2 Chips bei 390 px in Handschuh beobachten (Umbruch oder Scrollen), Ergebnis hier notieren
- [ ] 5.3 Mitlaufen: `command-palette`, `palette-oeffnung`, `palette-datensaetze`, `palette-gedaechtnis`, `palette-koordinate`, `gate1-ueberlauf`. Ergebnis hier notieren

## 6. Abschluss

- [ ] 6.1 Vitest der Palette, `pnpm lint`, `pnpm typecheck` und `./scripts/check-all.sh --nur schnell` grün; volles `check-all.sh` läuft in der CI des PRs

## Workflow follow-up

- `/opsx:archive lfh-982-sprungpalette-beruehrung` im selben Branch, dann PR gegen `alpha`.
