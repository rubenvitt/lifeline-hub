# Proposal

## Why

LFH-391 hat die Seitenaktionen „Neue Zeile“ und „Spalten“ in die Sprungpalette gebracht. Zwei
weitere Aktionen blieben dort liegen, weil sie keinen Träger hatten (LFH-507). „Status setzen“
wirkt je Zeile, und die Listen kennen bisher keine „aktuelle Zeile“, auf die eine
Palettenaktion wirken könnte. „Ansicht wechseln“ wäre ein Laufzeitschalter zwischen Tabelle und
Karte und damit eine Änderung der Formregel (LFH-330/AK3b), keine Paletteneinzelheit.

## What Changes

- **Fokuszeile:** Die aktuelle Zeile einer Liste ist die Zeile (Tabellenzeile oder Karte), die
  den Tastaturfokus enthält. Das bringt keinen neuen Zustand, keine neue Taste und keine neue
  Markierung, sichtbar ist sie über den Fokusring. Entschieden am 29.09.2026.
- **Neue Palettenaktion „Status setzen“** in der Gruppe „Aktionen“. Sie steht nur dann in der
  Palette, wenn der Fokus beim Öffnen in einer Zeile mit bedienbarem Statuswechsel lag. Sie
  öffnet das vorhandene Statusmenü genau dieser Zeile und legt den Fokus hinein. Gewählt wird
  dort, es entsteht kein zweiter Weg zum Wert. Die Aktion hat kein Tastenkürzel.
- **Nie über den Anzeige-Fallback:** Wird die Palette ohne Fokus in einer Zeile geöffnet (etwa
  über den „Suchen“-Knopf), fehlt „Status setzen“, auch wenn Zeilen vorhanden sind.
- **„Ansicht wechseln“ wird nicht gebaut.** Weil keine Entscheidung für einen Nutzerschalter
  vorliegt, gilt die Regel aus dem Ticket: Der Punkt wird geschlossen, nicht gebaut. Die
  Entscheidung „kein Nutzerschalter, die Form bleibt die begründete Entscheidung je Seite“
  steht in `CLAUDE.md` im Abschnitt „Die Liste ist die zweite Frage“.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `sprungpalette`: neue Anforderung „Status setzen wirkt auf die Fokuszeile“, samt dem
  Leerfall ohne Fokuszeile und der Sperre des Anzeige-Fallbacks für zeilengebundene Aktionen.

## Impact

- `frontend/src/command-palette/typen.ts` und `befehle.ts`: neue `TastaturAktionId`
  `status-setzen` (Verzeichnis, Reihenfolge, kein Kürzel).
- `frontend/src/command-palette/CommandPaletteProvider.tsx`: Ebenen können sich als „nur mit
  Fokus“ anmelden und scheiden dann aus dem Anzeige-Fallback aus.
- `frontend/src/components/StatusWahl.tsx`: meldet je bedienbarem Auslöser eine Ebene an, deren
  Wurzel die umgebende Zeile ist. Das Menü wird kontrolliert geöffnet.
- Wirkung auf alle Listen mit `StatusWahl` in Zeilen: Fahrzeuge, Personal, Material und das
  Meldebild. Das FMS-Tableau ist ausgenommen, eine Kachel ist keine Zeile.
- `CLAUDE.md`: die Entscheidung zu „Ansicht wechseln“ und eine Zeile unter „Sprungpalette“.
- Kein Backend und keine API-Änderung.
