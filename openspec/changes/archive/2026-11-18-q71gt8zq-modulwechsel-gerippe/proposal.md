# Proposal

## Why

Beim Wechsel des Moduls im Einsatz bleibt die alte Seite stehen, bis die neue fertig gezeichnet
ist. Ein Gerippe oder ein Ladezeichen gibt es dabei nicht. Am Produktions-Build dauert das bei
Betroffene 240–310 ms, bei Personal 300–360 ms und bei Fahrzeugen 195–220 ms, bei der Lagekarte
rund 440 ms (Messung 18.11.2026, Kommentar an LLH-1838). Wer in der Lage schnell umschaltet, weiß
in dieser Zeit nicht, ob der Klick angekommen ist, und klickt erneut oder liest noch die alte
Seite. Die Ursache: Der Router zeichnet jeden Wechsel als Übergang im Hintergrund, und React
hält bis zum Ende das alte Bild.

## What Changes

- Beim Wechsel in ein anderes Modul zeigt der Einsatzrahmen im ersten Bild den Seitenkopf der
  Zielseite mit dem Modulnamen und darunter das Gerippe. Danach zeichnet er die echte Seite, die
  das Gerippe ablöst.
- Das Gerippe wird erst nach einer kurzen Verzögerung (~120 ms) sichtbar. Bei einem schnellen
  Modul wechselt das Bild deshalb nur im Kopf und flackert nicht.
- Ein Wechsel innerhalb desselben Moduls (Unterroute, Detailseite, Suchparameter) bleibt, wie er
  ist.
- Lagekarte und Kräfteübersicht laden ihren Code nach. Ihr Ladetext „… wird geladen…“ weicht
  demselben Kopf mit Gerippe.
- Neue Rahmenregel in `frontend/AGENTS.md`.
- Nicht Teil dieser Change: Die Renderkosten der Seiten selbst senken. Das übernimmt LLH-1974.

## Capabilities

### New Capabilities

### Modified Capabilities
- `seiten-zustaende`: Neue Anforderung „Modulwechsel zeigt sofort Kopf und Gerippe“, neben den
  bestehenden Zuständen einer Seite, die (noch) nicht gezeigt werden kann.

## Impact

- Frontend: Einsatzrahmen (`einsatz/EinsatzLayout.tsx`), ein neuer kleiner Baustein für die
  Gerippe-Seite, `components/SeitenZustand.tsx` (verzögertes Gerippe), `theme/sprache.css`, die
  Suspense-Hüllen von Lagekarte und Kräfteübersicht in `App.tsx`.
- Kein Backend, keine API, keine Migration.
- Regel: `frontend/AGENTS.md`, Abschnitt „Rahmen“.
- Zunder: https://zunder.rubeen.dev/#/aufgabe/q71gt8zqe7csthgjpowlk2ra
