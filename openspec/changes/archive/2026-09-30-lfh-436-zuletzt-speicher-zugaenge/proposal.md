# Proposal

## Why

Die Gruppe „Zuletzt besucht" der Sprungpalette füllt sich seit LFH-337 nur noch über drei
Zugänge: Modul-Panel, Navigations-Drawer und Palette. Seitdem ist **Führung · Überblick** die
Startseite geworden. Von dort geht der häufigste Weg in ein Modul, und er zeichnet nichts auf.
Wer so arbeitet, bekommt die Abkürzungsliste nie gefüllt (LFH-436).

Dazu kommt ein zweites Problem. Der Speicher liegt je Browserprofil und hat kein Alter. Am
gemeinsam genutzten Fükw-Rechner erbt die nächste Schicht die Abkürzungen der vorigen, und
eine frisch geladene Sitzung zeigt womöglich einen Stand von vor vielen Stunden. Das
Befehls-Gedächtnis (`zuletzt_befehle`) ist aus demselben Grund auf den Server gezogen.

## What Changes

- Drei weitere Zugänge zeichnen auf, jeweils am **bewussten Klick**:
  - Führung · Überblick: Kennzahlen, Zeilenziele, Leer-Aktionen und Kopfknöpfe, soweit sie in
    ein Modul führen
  - Lage-Dashboard: Links und Knöpfe in ein Modul
  - Palette-Schnellaktionen: gemerkt wird das Modul der Aktion
- Weiterhin **ohne** Aufzeichnung, jetzt mit Begründung festgehalten: Rail-Sprung,
  Einsatz-Switcher samt Standardmodul-Weiterleitung, Deep-Links von außen und Querverweise
  innerhalb von Modulinhalten
- Der Speicher gilt **je Benutzer und Einsatz**. Jeder Eintrag trägt einen Zeitstempel und
  verfällt nach **12 Stunden**, das entspricht einer Schichtlänge.
- **BREAKING** (nur lokal): Bestehende Einträge im alten Format werden nicht übernommen. Die
  Liste startet nach dem Update leer.

## Capabilities

### New Capabilities

- `navigation-zuletzt-besucht`: welche Bedienwege die Abkürzungsliste „Zuletzt besucht"
  füllen, welche nicht, wem die Liste gehört und wann ein Eintrag verfällt

### Modified Capabilities

(keine: unter `openspec/specs/` gibt es noch keine Fähigkeit für die Navigation)

## Impact

- Frontend: `einsatz/zuletztModule.ts` (Format, Schlüssel, Frist, neuer Pfad-Helfer),
  `einsatz/EinsatzLayout.tsx`, `command-palette/useBefehle.ts`, `command-palette/befehle.ts`
  (Schnellaktionen), `pages/fuehrung/UeberblickPage.tsx`,
  `pages/lage-dashboard/LageDashboardPage.tsx` samt Paneelen
- Kein Backend, keine API, kein Codegen
- Die Kommentare, die heute „einziger Weg" bzw. „Panel, Drawer und Palette" sagen, werden
  nachgezogen (`EinsatzLayout.tsx`, `zuletztModule.ts`, `ModulPanel.tsx`)
