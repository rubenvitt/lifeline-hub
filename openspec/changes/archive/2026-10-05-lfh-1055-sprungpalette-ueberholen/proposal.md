# Proposal

## Why

Die Sprungpalette funktioniert, wirkt aber unruhig und doppelt sich (Ruben, 05.10.2026: „ist
hässlich“, „das Textfeld verhält sich komisch“, „CMD+A funktioniert glaube ich gar nicht“). Im
Browser nachgestellt zeigen sich neben den Gestaltungsmängeln zwei echte Bedienfehler: ein
ruhender Mauszeiger stiehlt die Markierung, sodass ↵ eine andere Zeile öffnet als den besten
Treffer, und Strg/⌘+Rücktaste löscht im Suchfeld nichts, weil die Palette die Taste schluckt.

## What Changes

- **Markierung folgt nur einem bewegten Zeiger.** Läuft die Liste beim Öffnen, Tippen oder Scrollen
  unter einem ruhenden Zeiger weg, bleibt die Markierung auf dem besten Treffer (heute
  `onMouseEnter`: „hell“ markierte „Darstellung: Dunkel“, ↵ hätte das Theme gewechselt).
- **Bearbeitungstasten gehören dem Suchfeld.** Strg/⌘+Rücktaste löscht bei offener Palette Wort
  bzw. Zeile; ⌘A/Strg+A markiert den ganzen Begriff (im Browser belegt, als Test festgehalten).
- **Startansicht ohne Dubletten.** Jeder Befehl steht einmal, in der obersten Gruppe, die ihn
  führt („Zuletzt ausgeführt“ vor „Schnellaktionen“, „Zuletzt besucht“ vor „Module“).
- **Schnellaktionen mit Modul.** Icon und Name des Trägermoduls statt eines Plus für alle;
  Beschriftung einheitlich Objekt + Verb („Person erfassen“, „ETB-Eintrag schreiben“,
  „Unfallhilfsstelle anlegen“ …). **BREAKING** für gemerkte Suchgewohnheiten: die alten Wörter
  („Neuer …“) bleiben als Schlagwort auffindbar.
- **Kopf:** kein zweiter Rahmen ums Suchfeld; die Modusanzeige („Nur Aktionen“) wird eine Marke im
  Kopf statt einer eigenen Zeile; „Esc“ statt „ESC“.
- **Zeilen:** Schrift auf der Skala (14 Label, 12 Kontext), feste Icon-Spalte (auch ohne Icon),
  aktive Zeile mit Fläche plus 2-px-Marke in Bedienfarbe, ↵-Marke mit reserviertem Platz.
- **Fußzeile:** eine Zeile in Sans 12, einheitliche Tastenmarken in festem Maß, Präfixe als eigene
  Gruppe rechts mit Kurzwort („Aktionen“, „ETB“, „Personen & Kräfte“, Langtext als Tooltip). Der
  Hinweis „Koordinate → Lagekarte“ entfällt (die Zeile erscheint beim Tippen selbst).

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `sprungpalette`: neue Anforderungen an Markierung und Zeiger, Bearbeitungstasten im Suchfeld,
  dublettenfreie Startansicht, Schnellaktionszeilen (Icon, Kontext, Beschriftung); die
  Fußzeilen-Anforderung wird um Einzeiligkeit und den Wegfall des Koordinatenhinweises ergänzt.
- `bedien-arbeitsplatz`: die Schnellaktion heißt „Person erfassen“ statt „Neue Person erfassen“.
- `navigation-zuletzt-besucht`: Szenario nennt „ETB-Eintrag schreiben“ statt „Neuer ETB-Eintrag“.

## Impact

- Frontend `frontend/src/command-palette/`: `CommandPalette.tsx` (Kopf, Zeile, Gruppen, Fußzeile,
  Zeiger), `CommandPaletteProvider.tsx` (Strg/⌘+Rücktaste), `befehle.ts` (Schnellaktionen),
  `typen.ts`/`fuzzy.ts` (Kurzwort der Präfixe), Tests daneben; e2e-Specs, die Labels oder die
  Fußzeile greifen.
- Regeln: `frontend/src/command-palette/AGENTS.md` (Zeiger, Startansicht), `frontend/AGENTS.md`
  (Wortlaut „Neue Person erfassen“ in „Keine Arbeitsplatzachse“).
- Kein Backend, keine Migration. Gemerkte Befehls-Ids bleiben gültig (die Ids ändern sich nicht).
- Abgrenzung: Ausblenden der Tastaturlegende auf Touch bleibt bei einem eigenen Ticket.
