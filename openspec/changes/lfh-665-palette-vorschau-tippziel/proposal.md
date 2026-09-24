# Proposal

## Why

Seit LFH-645 öffnet → in der Sprungpalette eine Lese-Vorschau, seit LFH-664 für jede
Datensatzsorte. Erreichbar ist sie aber nur per Tastatur. Die Palette ist auch der Berührungs-
und Handschuhweg zu 42+ Befehlen, gedacht für Führungs-Tablet und mobil. Wer dort tippt,
öffnet die Zeile direkt und kommt an die Vorschau nicht heran.

## What Changes

- Jede Zeile mit Vorschau bekommt rechts ein eigenes Tippziel (Chevron). Ein Tipp darauf
  öffnet die Vorschau statt des Datensatzes; ein Tipp auf die übrige Zeile öffnet wie bisher.
- Das Ziel ersetzt die `→`-Marke aus LFH-645 an der markierten Zeile. Es steht an **jeder**
  Zeile mit Vorschau, nicht nur an der markierten, weil es auf Touch kein Hover gibt. An der
  markierten Zeile trägt es die Bedienfarbe.
- Das Ziel ist ein handgebautes Bedienziel mit Boden aus der Dichte-Staffel (30/48/72) in
  Höhe und Breite. Es endet bündig an der rechten Zeilenkante und füllt die volle Zeilenhöhe,
  eine Linie trennt es sichtbar von der Zeile. Träger ist die reine Stilfunktion
  `vorschauZielStil` in `command-palette/zeilenStil.ts`.
- Der Fokus bleibt beim Tipp im Suchfeld: ↵, Esc/← und die Live-Ansage gelten danach wie nach →.

## Capabilities

### Modified Capabilities

- `sprungpalette` — zwei Anforderungen werden geändert: „Fußzeile und Zeilenmarke kündigen
  die Wege an“ aus LFH-645 (`openspec/changes/lfh-645-palette-vorschau-neuer-tab/`) und
  „Jede Datensatzsorte hat eine Vorschau“ aus LFH-664
  (`openspec/changes/lfh-664-palette-vorschau-datensatzsorten/`), beide, weil sie die
  `→`-Marke an der markierten Zeile verlangen. Eine Anforderung für das Tippziel kommt hinzu. Die Fähigkeit liegt noch nicht in
  `openspec/specs/`; **Archivreihenfolge: LFH-645, dann LFH-664, dann dieser Change.**

## Impact

- `frontend/src/command-palette/CommandPalette.tsx` (`optionsZeile`), `zeilenStil.ts`.
- Tests: `zeilenStil.test.ts`, `CommandPalette.oeffnung.test.tsx`,
  `CommandPalette.zeilenstil.test.tsx`, `e2e/palette-oeffnung.spec.ts`.
- Kein Backend, keine Datenänderung.
