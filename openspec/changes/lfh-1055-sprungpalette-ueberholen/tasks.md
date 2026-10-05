# Tasks

## 1. Bedienfehler im Suchfeld

- [ ] 1.1 Zeiger (D1): Test „ruhender Zeiger markiert nicht, bewegter schon“ in `CommandPalette.test.tsx` (rot gegen `onMouseEnter`), dann `onMouseMove` mit Positionsvergleich; Vitest grün
- [ ] 1.2 Strg/⌘+Rücktaste (D2): Test in `CommandPaletteProvider.test.tsx`, dass die Taste bei offener Palette nicht `defaultPrevented` ist und die Ebene nichts bekommt; Provider anpassen; Vitest grün
- [ ] 1.3 e2e `command-palette.spec.ts`: ruhender Zeiger über der Liste + Tippen → erster Treffer markiert; Strg+Rücktaste löscht ein Wort; Strg+A markiert alles (Chromium)

## 2. Startansicht und Schnellaktionen

- [ ] 2.1 Dubletten (D3): Test „gemerkte Schnellaktion fehlt in Schnellaktionen, besuchtes Modul fehlt in Module“; Gruppenaufbau mit Kernschlüssel; Vitest grün
- [ ] 2.2 Schnellaktionen (D4): Icon und Kontext des Trägermoduls, neue Beschriftungen, alte als Schlagwort; Pins in `befehle.test.ts`, `befehle.modulstatus.test.ts`, `CommandPalette.test.tsx`, `fuzzy.test.ts` und e2e nachziehen; Test „neuer etb“ findet „ETB-Eintrag schreiben“
- [ ] 2.3 Regeln: `command-palette/AGENTS.md` (Zeiger, Startansicht, Beschriftungsmuster) und Wortlaut in `frontend/AGENTS.md` („Keine Arbeitsplatzachse“) nachziehen; `prettier --check` grün

## 3. Gestalt

- [ ] 3.1 Kopf (D5): kein Feldumriss, Modusmarke im Kopf, „Esc“; Modustests in `CommandPalette.test.tsx` anpassen
- [ ] 3.2 Zeile und Liste (D6): Skala, Icon-Spalte, aktive Marke, reservierte ↵-Marke, Gruppenkopf bündig; `CommandPalette.zeilenstil.test.tsx` grün
- [ ] 3.3 Fußzeile (D7): einzeilig, Kurzwörter in `PALETTE_MODI`, ohne Koordinatenhinweis; Fußzeilentests anpassen; e2e-Messung der Fußzeilenhöhe bei 1440 px in drei Dichten

## 4. Abschluss

- [ ] 4.1 Vorher/Nachher-Bilder (Nacht/Tag, drei Dichten) neu aufnehmen und dem PR beilegen
- [ ] 4.2 `./scripts/check-all.sh` und betroffene e2e-Specs grün; Review
