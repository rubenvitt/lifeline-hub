# Proposal

## Why

Der Neuentwurf (S2) zeigt in der Fußzeile der Sprungpalette den Hinweis `⇧↵ im Panel`. Eine
Fläche, auf der ein Datensatz „im Panel“ neben der laufenden Arbeit erscheint, hat die App
aber nicht (LFH-619, Entscheidung 22.09.2026). LFH-645 hat die fachliche Bedeutung am
23.09.2026 nach dem Raycast-Muster festgelegt. Die Palette bekommt zwei neue Öffnungswege:
**Strg/⌘+↵ öffnet das Ziel in einem neuen Browser-Tab**, **→ öffnet eine Vorschau in der
Palette**. Wer sucht, kann so einen Treffer prüfen, ohne den Suchzustand zu verlieren, oder
ihn neben der aktuellen Arbeit in einem eigenen Tab öffnen. Dafür entsteht keine neue
Drawer-Fläche (LFH-19).

## What Changes

- **Strg/⌘+↵ (neuer Tab):** Öffnet das Ziel der markierten Zeile in einem neuen Browser-Tab.
  Das gilt für jede Zeile mit Navigationsziel: Datensätze, ETB-Sammeltreffer, Koordinate,
  Module, Zuletzt, Schnellaktionen, Einsatzwechsel, Navigation und das Befehlsgedächtnis.
  Zeilen ohne Ziel (Aktionen, Einstellungen, Abmelden) reagieren nicht und fallen auch
  nicht auf ↵ zurück. Die aktuelle Seite bleibt stehen, die Palette schließt sich.
  Strg/⌘+Klick auf eine Zeile bewirkt dasselbe.
- **→ (Vorschau):** Steht der Cursor am Ende des Suchfelds und hat die markierte Zeile eine
  Vorschau, ersetzt eine Lese-Vorschau die Trefferliste in der Palette (eingeklappte statt
  geteilte Ansicht). Aus der Vorschau führt Esc oder ← zurück zu den Treffern, Suchbegriff
  und Markierung bleiben dabei erhalten. ↵ öffnet den Datensatz, Strg/⌘+↵ öffnet ihn im
  neuen Tab. Wer weitertippt, kehrt zur Trefferliste zurück. Steht der Cursor nicht am
  Textende, bewegt → wie gewohnt den Cursor.
- **Vorschau zuerst für Personen:** Der Inhalt aus `PersonDetailDrawer` wird zu einer
  gemeinsamen `PersonVorschau`, die der Drawer und die Palette beide nutzen. Die übrigen
  Datensatzsorten und ein Tippziel für Touch/Tablet kommen als Folgetickets.
- **⇧↵ bleibt ohne Belegung.** Der Hinweis „⇧↵ im Panel“ aus dem Neuentwurf entfällt.
- **Fußzeile:** zeigt neu `⌘↵ neuer Tab` bzw. `Strg+↵ neuer Tab` und im Einsatz `→ Vorschau`.
  Die aktive Zeile trägt zusätzlich eine `→`-Marke, wenn sie eine Vorschau hat.

## Capabilities

### New Capabilities
- `sprungpalette`: Öffnungswege der Sprungpalette (Strg/⌘+↵ neuer Tab, → Vorschau in der
  Palette) und ihre Fußhinweise.

### Modified Capabilities
<!-- keine: für die Palette gab es bisher keine Spec -->

## Impact

- `frontend/src/command-palette/`: `typen.ts` (`Befehl.ziel`, `Befehl.vorschau`,
  `Oeffnung`), `befehle.ts`, `datensaetze.ts`, `koordinatenSprung.ts` sowie
  `useDatensaetze.ts`/`useKoordinatenSprung.ts` (Öffnungsart bis zu `navigate`
  durchreichen), `CommandPalette.tsx` (Tasten, Vorschau-Modus, Fußzeile),
  `CommandPaletteProvider.tsx` (neuer Tab über `window.open`), neu `Vorschau.tsx`.
- `frontend/src/personen/`: `PersonDetailDrawer.tsx` wird aufgeteilt, neu `PersonVorschau.tsx`.
- Tests: Vitest in `command-palette/` und `personen/`, dazu e2e in `e2e/command-palette.spec.ts`
  (neuer Tab als Kaltstart, Vorschau).
- Kein Backend und keine API betroffen. Die Sitzung liegt im Cookie, ein neuer Tab ist
  also angemeldet.
- Betrieb: Ohne TLS belegt jeder weitere Tab eines Einsatzes eine SSE-Verbindung von den
  6 HTTP/1.1-Verbindungen je Origin. Mit TLS spricht der Server HTTP/2.
