# Proposal

## Why

Ein überfälliger Termin der nächsten Lagebesprechung trägt heute zwei Töne. Die Stab-Seite zeigt
ihn in `achtung` mit „seit 5 min überfällig“, die Fristenliste „Nächste Marken“ im
Führungsüberblick in `alarm` mit „überfällig“. Wer zwischen beiden Seiten wechselt, liest
denselben Termin einmal als Hinweis und einmal als Alarm. LFH-550 hat die Frage bewusst
offengelassen (Non-Goal in
`openspec/changes/archive/2026-09-30-lfh-550-lagebesprechung-eine-verdichtung/design.md`); sie
wird hier entschieden.

## What Changes

- **Entscheidung:** Ein überfälliger Besprechungstermin trägt auf beiden Oberflächen `achtung`,
  nie `alarm`. Eine Lagebesprechung ist kein Gefahrenereignis; `alarm` bleibt für Gefahren und
  verletzte Aufträge, damit das Alarmbudget (EEMUA 191/ISA-18.2, ≤ 3 Stufen) nicht verwässert.
- **Ein Wort:** Beide Oberflächen sagen dasselbe, nämlich das Wort der Stab-Seite: „jetzt fällig“
  in der ersten Minute ab dem Termin, danach „seit 5 min überfällig“ bzw. „seit 2 h 05 min
  überfällig“. Die Fristenliste sagt für kommende Fristen schon „in 23 min“; das Gegenstück mit
  Dauer passt dazu.
- **Eine Stelle:** Ton und Wort des überfälligen Termins entstehen in einer Funktion in
  `stab/lagebesprechungZustand.ts`. Die Stab-Seite und die Fristenliste rufen sie beide; die
  Fristenliste nutzt sie nur für die Marke „Lagebesprechung“.
- **Ein Test pinnt die Gleichheit:** für mehrere überfällige Abstände liefern Stab-Zustand und
  Marke denselben Ton und dasselbe Wort.
- Die Regel kommt in `frontend/src/stab/AGENTS.md`.

Keine Änderung an Server, Daten oder Typen. Keine **BREAKING**-Änderung.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `lagebesprechung-vorbereitung`: neue Anforderung „Ein Ton für den überfälligen
  Besprechungstermin“ (Stab-Seite und Führungsüberblick zeigen denselben Ton und dasselbe Wort).

## Impact

- `frontend/src/stab/lagebesprechungZustand.ts` samt Test.
- `frontend/src/pages/fuehrung/ueberblickDaten.ts` (`markenBewertung`, `naechsteMarken`) samt Test.
- `frontend/src/stab/AGENTS.md`.
- Sichtbar: im Führungsüberblick färbt sich die überfällige Marke „Lagebesprechung“ gelb statt
  rot und nennt die Dauer. Überfällige Aufträge und Erinnerungen bleiben rot.
- Nur Frontend. Kein Backend, keine Migration, kein Typ-Codegen.
