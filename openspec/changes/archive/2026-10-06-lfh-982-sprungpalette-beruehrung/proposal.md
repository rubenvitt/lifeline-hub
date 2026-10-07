# Proposal

## Why

Auf Handy und Führungs-Tablet ist die Sprungpalette der schnelle Weg zu Modulen, ETB-Einträgen
und Personen. Dort zeigt sie aber nur Tastaturwege: Im Kopf steht eine umrandete „Esc“-Marke, die
wie ein Knopf aussieht und sich nicht antippen lässt, und die Fußzeile („↵ öffnen“, „Strg ↵ neuer
Tab“, „→ Vorschau“) steht dort, obwohl keine Taste da ist (bei 390 px zwei Zeilen, 51 px; das
Ticket maß vor der letzten Überholung noch drei Zeilen und rund 95 px). Die einzige Hilfe, die
auch ohne Tastatur wirkt, die Präfixe `> # @`, geht dazwischen unter und lässt sich nur tippen,
nicht antippen.

## What Changes

- Die Palette fragt die Zeigerart ab (`useViewport().istBeruehrung`, `(pointer: coarse)`), nicht
  die Breite. Ein Fükw mit schmalem Fenster behält alle Tastaturhinweise.
- Bei grobem Zeiger ersetzt eine echte Schließen-Schaltfläche („Sprungpalette schließen“,
  mindestens 48 × 48 px, wächst mit der Dichte-Staffel) die Esc-Marke im Kopf.
- Bei grobem Zeiger entfallen alle Tastenhinweise: in der Fußzeile ↵, Strg/⌘+↵, → und Esc, an
  den Zeilen die Kürzelmarken (etwa „Strg + Rücktaste“) und die ↵-Marke der aktiven Zeile.
- Bei grobem Zeiger trägt die Fußzeile die drei Präfixe als antippbare Filterchips. Ein Tipp
  setzt das Präfix vor den Suchbegriff und gibt dem Suchfeld den Fokus zurück; ein Tipp auf den
  aktiven Chip nimmt das Präfix wieder weg. Die Chips stehen in einer Zeile.
- Bei grobem Zeiger trägt die Fußzeile in der Vorschau einen Knopf „Öffnen“, den Tippweg für das,
  was am Fükw ↵ tut. Zurück führt der vorhandene Knopf „Zurück“ im Vorschaukopf.
- Bei feinem Zeiger bleiben Kopf, Fußzeile, Zeilenmarken und der ganze Tastaturvertrag unverändert.
- Neue Regel „Zeigerart“ in `frontend/src/command-palette/AGENTS.md`.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `sprungpalette`: Die Anforderung „Fußzeile und Zeilenmarke kündigen die Wege an“ gilt künftig
  für den feinen Zeiger; eine neue Anforderung legt fest, was die Palette bei grobem Zeiger zeigt
  (Schließknopf, keine Tastenhinweise, Präfix-Chips, „Öffnen“ in der Vorschau).

## Impact

- Code: `frontend/src/command-palette/CommandPalette.tsx` (Weiche, Kopf, Fußzeile, Zeilenmarken),
  ggf. ein kleines Stilmodul neben `zeilenStil.ts` für Chip- und Knopfmaß.
- Tests: `CommandPalette.test.tsx` (neuer Block mit `setzeZeigerGrob`), `e2e/command-palette.spec.ts`
  (Touch bei 390 und 820 px, auch als Beobachter).
- Regeln: `frontend/src/command-palette/AGENTS.md`, Spec `sprungpalette`.
- Kein Backend, keine Migration, keine API.
- Überschneidung: die Arbeit an den Modulbeschreibungen (zweite Zeile im Modulmenü und in der
  Palette) ändert dieselbe Zeilenfunktion `optionsZeile`, aber deren linken Teil (Label); diese
  Change ändert nur die Marken rechts.
