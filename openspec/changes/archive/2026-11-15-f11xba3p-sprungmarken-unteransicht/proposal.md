# Proposal

Zunder: LLH-1733 (https://zunder.rubeen.dev/#/aufgabe/f11xba3p3pmklaam3nh2h9g3)

## Why

Die Sprungmarken im Modulmenü tragen rechts das Pfeil-Symbol `IconExternPfeil`, das wie „öffnet
ein neues Fenster“ aussieht; sie springen aber nur in eine Ansicht eines vorhandenen Moduls.
„Entscheidungen“ steht zudem in der Kategorie Führung, springt aber ins ETB (Erfassung): nach dem
Klick wechselt die Hervorhebung in eine andere Kategorie, und die Marke ist aus dem Blick.

## What Changes

- Jede Sprungmarke steht in der **Kategorie ihres Zielmoduls**. „Entscheidungen“ wandert aus
  Führung nach Erfassung, direkt hinter ETB. Die übrigen Marken stehen schon dort.
- Eine Marke erscheint als **eingerückte Unteransicht** ihres Zielmoduls, mit einer feinen
  senkrechten Führungslinie, die sie an die Zeile darüber bindet. Das Pfeil-Symbol entfällt; das
  Schloss bei Sperre bleibt.
- Unverändert: Die Hervorhebung nach dem Sprung trägt das Zielmodul, nie die Marke
  (`aria-current`); der zugängliche Name nennt weiter das Ziel („Entscheidungen, springt zu ETB ·
  Entscheidung“). Sichtbarkeit und Sperre erbt die Marke wie bisher.
- Die Sprungpalette nennt als Kontext der Marke weiter ihr Zielmodul; sie ändert sich nicht.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `modul-sprungmarken`: neue Anforderung, wo eine Marke steht (Kategorie und direkt hinter ihrem
  Zielmodul oder dessen Marken) und wie sie sich von einer Modulzeile abhebt (eingerückt, ohne
  Pfeil).

## Impact

- Frontend: `frontend/src/einsatz/sprungmarken.ts` (Kategorie und Anker von „Entscheidungen“),
  `frontend/src/einsatz/ModulPanel.tsx` (Zeile der Marke), dazu deren Tests und
  `frontend/e2e/nav-schmal.spec.ts` (zählt auf „Entscheidungen“ in der Führung).
- Gilt im Modulpanel (Fükw, Tablet) und im Navigations-Drawer, die dieselbe `ModulListe` nutzen.
- Regeln und Doku: `frontend/AGENTS.md` („Sprungmarken sind keine Module“),
  `docs/anwender/kapitel/einsatz-oberflaeche.md` samt Bildern, deren Ansicht das Modulmenü zeigt.
- Kein Backend, keine Migration, keine Routen oder gespeicherten Schlüssel.
