# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/gw8jul0fpxfzgwbk1jt7g7qq (LLH-1127)

## Why

Ruben (10.10.2026): „Die Funktionen sind nicht global aufrufbar, nicht über ⌘K zu finden.“
Funkplan, Fernmeldeskizze, Kommunikationsplan, Pressearbeit und Informationstelefon erreicht
man heute nur über die Stab-Seite, dort über die richtige Sachgebietszeile und einen kleinen
Link. Wer „Funk“ oder „Info“ in die Sprungpalette tippt, findet nichts. Im Funkverkehr oder bei
einem eingehenden Bürgeranruf sind das zu viele Schritte. Auch die bestehenden Sprungmarken
(Entscheidungen, Patienten, Vermisste, FMS-Tableau) stehen nur im Modulmenü, nicht in der
Palette.

## What Changes

- **Fünf neue Sprungmarken unter „Stab“** im Modulmenü (Fükw-Panel, Tablet, Navigations-Drawer):
  Pressearbeit, Informationstelefon (S5), Funkplan, Fernmeldeskizze, Kommunikationsplan (S6), in
  dieser Reihenfolge direkt hinter „Stab“. Sie erben Sichtbarkeit und Sperre vom Stab wie jede
  Sprungmarke (LFH-620).
- **Sprungmarken in der Sprungpalette:** alle Sprungmarken, die bestehenden und die neuen, stehen
  als eigene Gruppe „Ansichten“ in der Palette, mit Schlagworten („funk“, „sprechgruppe“, „s6“,
  „presse“, „bürgertelefon“ …). Angeboten wird eine Marke nur, wenn ihr Zielmodul frei ist;
  ↵ öffnet, Strg/⌘+↵ öffnet im neuen Tab.
- **Schnellaktion „Anruf erfassen“:** springt ins Informationstelefon und setzt den Fokus in die
  Anruferfassung (`?neu=1`, neuer Leser auf der Seite). Der Schnellaktionen-Guard lernt, dass
  Stab-Unterseiten zum Trägermodul „Stab“ gehören.
- **Regeln:** Sprungmarken-Regel in `frontend/AGENTS.md` (LFH-620), Palette-Regeln in
  `frontend/src/command-palette/AGENTS.md` und Einstiegsangaben in `frontend/src/stab/AGENTS.md`
  nachgezogen.
- **Anwenderdoku:** Kapitel `stab.md` und `einsatz-oberflaeche.md` nachgezogen.

## Capabilities

### New Capabilities

- `modul-sprungmarken`: Sprungmarken im Modulmenü, also gefilterte Sichten oder Unterseiten
  eines Moduls als eigene Zeile; welche es gibt, wo sie stehen, was sie vom Zielmodul erben.

### Modified Capabilities

- `sprungpalette`: neue Gruppe „Ansichten“ mit den Sprungmarken; „Anruf erfassen“ als
  Schnellaktion; die Aufzählung der Zeilen mit Navigationsziel (Strg/⌘+↵) und der
  Schnellaktions-Beschriftungen wächst entsprechend.

## Impact

- Nur Frontend: `einsatz/sprungmarken.ts`, `command-palette/` (`befehle.ts`, `typen.ts`,
  Guard `schnellaktionen.guard.test.ts`), `routing/deeplinks.ts` (`infotelefonPfad` mit `neu`),
  `pages/InfotelefonPage.tsx`, `infotelefon/AnrufErfassung.tsx`.
- Keine Migration, kein Endpunkt, kein Typ-Codegen.
- Bezug zu LLH-1116 („Stab je Organisation abwählbar …“, Entscheidung offen): Werden die
  S6-Seiten dort ein eigenes Modul, wandern die S6-Marken in die Registry; die Palette-Einträge
  bleiben für den Bediener dieselben.
