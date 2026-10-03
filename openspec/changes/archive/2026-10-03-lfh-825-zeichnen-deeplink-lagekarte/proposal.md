# Proposal

## Why

Ein Gefahrengebiet entsteht nur durch Zeichnen auf der Lagekarte. Der Weg dorthin führt über die
Leiste, das Paneel „Zeichnen“ und den Knopf des Zonentyps; am Handschirm ist die Leiste per Vorgabe
zu, also kommt ein Griff dazu. Die Sprungpalette bietet für vier Module Schnellaktionen an, für
Gefahren bewusst nicht (LFH-506): die Gefahrenmatrix hat keine Erfassungsmaske, eine Zeile dorthin
zeigte ins Leere. Mit einem Zeichnen-Deeplink auf die Lagekarte bekommt die Palette einen
Einstieg, der wirklich im Zeichenmodus landet (Entscheidung 03.10.2026, LFH-825).

## What Changes

- Die Lagekarte liest `?zeichnen=<zonentyp>` (optional `:flaeche`/`:linie` für die freie Skizze),
  betritt den Zonen-Zeichenmodus dieses Typs und räumt den Parameter danach (anwenden, dann räumen,
  wie `?platzieren=`). Angenommen wird jeder Zonentyp des Zeichnen-Paneels; ohne Schreibrecht, mit
  unbekanntem Typ oder unpassender Form wird nur geräumt.
- `lagekartePfad` bekommt die Option `zeichnen`; ein exhaustiver Parser in
  `routing/deeplinks.ts` liest den Auftrag zurück.
- Die Sprungpalette führt die Schnellaktion „Gefahrengebiet zeichnen“ mit Trägermodul `lagekarte`
  (nicht `gefahrenzonen`), nur mit Schreibrecht im Einsatz und freigegebener Lagekarte.
- Der Schnellaktions-Guard lernt eine zweite Aktionsart: Eine Schnellaktion nennt den
  Suchparameter, den ihre Zielseite liest (`neu` oder `zeichnen`). Die Regel „Ziel liegt unter dem
  Modulpfad des eigenen Trägers“ bleibt unverändert; gedeckt wird die Zeichen-Aktion durch einen
  `?zeichnen`-Leser der Lagekarte statt durch einen `?neu=1`-Leser.
- Der Ausschluss „GEFAHREN FEHLEN BEWUSST (LFH-506)“ in `command-palette/befehle.ts` wird durch den
  neuen Eintrag ersetzt; die Regel der Zeichen-Aktion steht in `command-palette/AGENTS.md`.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `lagekarte-zeichnen`: neue Anforderung „Zeichnen per Link“ — `?zeichnen=` betritt den
  Zonen-Zeichenmodus, nur mit Schreibrecht, Parameter wird stets geräumt.
- `sprungpalette`: neue Anforderung „Gefahrengebiet zeichnen aus der Palette“ — Schnellaktion mit
  Ziel Lagekarte, Sichtbarkeit an Schreibrecht und Lagekarte-Freigabe.

## Impact

- Nur Frontend: `routing/deeplinks.ts`, `pages/LagekartePage.tsx`, `pages/lagekarte/` (Auftrag →
  Zonen-Entwurf, gemeinsame Vorgabefarbe der freien Skizze mit `Sidebar.tsx`),
  `command-palette/befehle.ts`, `command-palette/schnellaktionen.guard.test.ts`,
  `command-palette/befehle.test.ts`, `command-palette/AGENTS.md`, `pages/lagekarte/AGENTS.md`.
- Kein Backend, keine API, keine Migration. Die Zone wird wie bisher über den bestehenden
  Zeichnen-Ablauf gespeichert.
