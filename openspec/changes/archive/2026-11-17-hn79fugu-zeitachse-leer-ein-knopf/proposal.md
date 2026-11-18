# Proposal

## Why

Ohne gesicherte Stände zeigt die Lagekarte mit Schreibrecht ein Zeitachsen-Band über die volle
Kartenbreite. Darin stehen nur „Zeitachse ausblenden“ und ein Knopf, der nur ein Kamera-Symbol
trägt (LLH-1936, Befund der UI/UX-Analyse aus LLH-1751). Das Band kostet Kartenhöhe und erklärt
sich nicht. Seit LLH-1751 tragen die Kartenknöpfe ein Wort, der Knopf „Stand sichern“ nicht.

## What Changes

- Ohne gesicherte Stände und mit Schreibrecht steht statt des Bands nur ein Knopf
  „Stand sichern“ mit Symbol und Wort unten links in der Karte, an der Stelle des eingeklappten
  Knopfs „Zeitachse einblenden“. Ein Knopf zum Ausblenden entfällt, und die gemerkte Klappwahl
  gilt in diesem Zustand nicht.
- Ab dem ersten gesicherten Stand verhält sich die Zeitachse wie bisher: Band oder eingeklappter
  Knopf, je nach gemerkter Wahl und Breite.
- Im vollen Band trägt der Knopf „Stand sichern“ ebenfalls das Wort „Stand sichern“ neben dem
  Symbol. Das Band hat weiter höchstens zwei Reihen und im Fükw eine.
- Ohne Schreibrecht und ohne Stände erscheint wie bisher gar nichts.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `lagekarte-zeitachse`: neue Anforderung für den Zustand ohne gesicherte Stände (nur ein Knopf
  mit Wort); die Anforderung „Stand sichern über einen kurzen Dialog“ verlangt das Wort am Knopf.

## Impact

- Frontend: `frontend/src/pages/lagekarte/SnapshotLeiste.tsx` (Leerzustand, Wort am Knopf,
  Gruppenbasis in `bandStile`), dazu `SnapshotLeiste.test.tsx`.
- e2e: Tests, die das ausgeklappte Band in einem Einsatz ohne Stände voraussetzen, sichern vorher
  einen Stand (u. a. `lagekarte-smoke`, `lagekarte-touch`, `lagekarte-werkzeugmenue`,
  `eingangsband-ausweichen`); `leisten-flaeche.spec.ts` bekommt den Leerzustand als Messung.
- Regel `frontend/src/pages/lagekarte/AGENTS.md`, „Das Zeitachsen-Band hat höchstens zwei Reihen“.
- Doku-Bilder des Kapitels „Lagekarte“, falls sie die leere Zeitachse zeigen.
- Kein Backend, keine API, keine Migration.

Zunder: https://zunder.rubeen.dev/#/aufgabe/hn79fuguy5e2il8acuph7kug
