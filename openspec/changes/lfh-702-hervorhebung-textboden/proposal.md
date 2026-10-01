# Proposal

## Why

Der Kontrast-Spec der Betroffenenliste (`e2e/betroffene-kontrast.spec.ts`, LFH-650) misst den
Platzhalter-Knopf „Zustand hinzufügen“ unter dem Zeiger mal grün, mal rot (LFH-702). Ursache ist
die Messung: `pruefe()` nimmt per `toPass` den ersten grünen Versuch. Läuft die Hover-Transition
der Zeile noch, ist der Grund noch weiß, und der Test besteht. Im eingeschwungenen Zustand steht
`bedienText` auf der Hover-Fläche `flaeche3` bei 6,59 : 1, unter dem Tagesboden 7 : 1.

Der Unterschuss betrifft nicht nur diesen Knopf. Am Tag liegen `bedienText` (6,59) und
`gedaempft` (6,60) auf jeder Hervorhebungsfläche `flaeche3` unter dem Boden, also in jeder
Hover- und Aktivzeile einer Katalogtabelle. Die Spec `textkontrast-rollen` hat diese Fläche
bisher ausdrücklich ausgenommen (Grenze aus LFH-652, offen als LFH-877). Am Phase-1-Checkpoint
wurde entschieden, beide Tasks in einer Change zu lösen und den Boden über die Textrollen zu
halten.

## What Changes

- Die Kontrastmessung aller Kontrast-Specs (`e2e/kontrast-kern.ts`) wartet laufende, endliche
  Animationen und Transitions am gemessenen Element und an seinen Vorfahren ab. Erst danach misst
  sie. Ein Wert unter dem Boden macht den Test verlässlich rot, unabhängig vom Zeitpunkt.
- Tagpalette: `bedienText` wird von `#164f86` auf `#144779` abgedunkelt, `gedaempft` von
  `#474e57` auf `#40464e`. Ton und Sättigung bleiben, beide werden um etwa 10 % dunkler. Auf
  `flaeche3` halten sie damit 7,46 bzw. 7,47. Die Nachtpalette bleibt unverändert.
- Spiegel in `theme/rollen.css` (Gate 5) und die Kontrast-Kommentare an `farbenHell` werden
  nachgezogen.
- Die Spec `textkontrast-rollen` nimmt die Hervorhebungsfläche (Hover- und Aktivzeile) in den
  Grund auf, gegen den gemessen wird. Neu ist die Anforderung, im eingeschwungenen Zustand zu
  messen.
- Nachweis im Browser: In einer Tabellenzeile unter dem Zeiger werden ein Link und ein „—“
  gemessen, in beiden Modi (AK LFH-877). Der bisher flackernde Fall in
  `betroffene-kontrast.spec.ts` ist danach stabil grün.
- `frontend/AGENTS.md` (Farbachsen, Tagmodus) und `frontend/e2e/AGENTS.md` (Messung im
  eingeschwungenen Zustand) werden fortgeschrieben.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `textkontrast-rollen`: Der Boden für geerbten Text gilt auch auf der Hervorhebungsfläche
  unter dem Zeiger und in der Aktivzeile. Gemessen wird im eingeschwungenen Zustand. Die Menge
  der Rollen bleibt gleich, die Werte zweier Tagrollen ändern sich bewusst.

## Impact

- `frontend/e2e/kontrast-kern.ts`: `pruefe()`/`kontrast()` warten auf den eingeschwungenen
  Zustand. Das betrifft alle Kontrast-Specs (`abloesung`, `betroffene`, `fachebenen`,
  `hellmodus`, `kraefte`, `primaerknopf`, `verpflegung`, `dokumente`). Hover-Messungen, die bisher
  nur zufällig grün waren, können dabei rot werden.
- `frontend/src/theme/tokens.ts` (`farbenHell.bedienText`, `farbenHell.gedaempft`, Kommentare),
  `frontend/src/theme/rollen.css` (Tag-Spiegel), `frontend/src/theme/bedienKontrast.test.ts`
  (gerechneter Boden auf den Flächenstufen).
- `frontend/e2e/dokumente.spec.ts` bzw. `frontend/e2e/betroffene-kontrast.spec.ts`:
  Hover-Messungen.
- Sichtbar am Tag: Jeder Link, jeder Beschreibungstext und jeder Tabellenkopf wird etwas dunkler.
  Nachts ändert sich nichts.
- Nebenwirkung zum Guten: `bedienText`/`gedaempft` auf `alarmFlaeche` steigen von 6,86 auf 7,76.
- Die ETB-Typfarbe `system.wort` verweist auf `gedaempft` und zieht samt Spiegel
  `--lfh-etb-system-wort` mit.
- Nicht betroffen: `schwach` (4,99 auf `flaeche3`, bleibt bei LFH-643).
