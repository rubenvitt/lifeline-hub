# Tasks

Umgesetzt per TDD (`superpowers:test-driven-development`): erst der rote Test, dann die
Umsetzung.

## 1. Tippziel

- [x] 1.1 `vorschauZielStil(token)` in `command-palette/zeilenStil.ts`: Boden `controlHeight` in Höhe und Breite, Polsterung aus `paddingXS`/`paddingSM`, `border-box`, Rückzug um die Zeilenpolsterung (`marginInlineEnd`, `marginBlock`, `stretch`), Trennlinie. Belegt in `zeilenStil.test.ts` mit Literalen über drei Stufen und der Aussage „wächst über die Stufen“.
- [x] 1.2 `optionsZeile` in `CommandPalette.tsx`: Ziel an jeder Zeile mit `vorschau`, `aria-hidden`, `mousedown` abgefangen, `click` mit `stopPropagation` öffnet die Vorschau. Die `kbd`-→-Marke entfällt. Belegt in `CommandPalette.oeffnung.test.tsx` als Paar (Ziel → Vorschau, Label → Datensatz), dazu nicht markierte Zeile, Strg/⌘-Klick, Fokus und kein zweiter Pfeil; Mutationsproben ohne `stopPropagation` (3 rot) und ohne `preventDefault` (1 rot).
- [x] 1.3 `CommandPalette.zeilenstil.test.tsx`: Mock um `vorschauZielStil` ergänzen und als Nachweis nutzen, dass das Ziel die Funktion verwendet.

## 2. Browser-Nachweis

- [x] 2.1 `e2e/palette-oeffnung.spec.ts`: Dichte-Test öffnet die Vorschau per Klick aufs Ziel und misst dessen Box in allen drei Stufen (Höhe, Breite, bündig rechts, volle Zeilenhöhe).
- [x] 2.2 Neuer Tablet-Test (`hasTouch`, 1024 × 768, Handschuh): Tipp aufs Ziel öffnet die Vorschau, Tipp aufs Label die Person.

## 3. Doku

- [x] 3.1 CLAUDE.md, Absatz Sprungpalette: das Tippziel eintragen.
