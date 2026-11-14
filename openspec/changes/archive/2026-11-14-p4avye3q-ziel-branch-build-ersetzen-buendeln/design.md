# Design

## Context

Wie „Baut mit Ziel-Branch“ arbeitet, steht in `scripts/AGENTS.md` (Abschnitt „Baut mit Ziel-Branch“) und in `openspec/changes/archive/2026-11-12-g10eo9co-alpha-rot-schutz/design.md`. Eine Bewegung des Ziel-Branches lässt `verteilen` an jedem fertigen PR einen Check auf „läuft“ setzen und je PR einen Einzellauf starten (`workflow_dispatch`). Läufe eines PRs teilen sich eine `concurrency`-Gruppe.

Am 14.11.2026 kam das Rot aus vier Stellen (an Läufen geprüft):

1. `cancel-in-progress: true` bricht den rechnenden Lauf ab. Seine Jobs „Kompilieren“ und „Melden“ enden `cancelled` und stehen am Kopf-Commit des PRs (z. B. Lauf 43600965698).
2. `einzellauf` schließt den Check von `verteilen` als `cancelled` („Übernommen“).
3. `melden` schließt ein überholtes Ergebnis als `cancelled` („Überholt“).
4. Push-Läufe brechen sich gegenseitig ab, `verteilen` endet dann mittendrin.

Ein Lauf, der in der Warteschlange ersetzt wird, legt keine Jobs an (Lauf 43602657284: 0 Jobs) und zeigt am PR nichts.

## Goals / Non-Goals

**Goals:**
- Kein Rot ohne Fehler. Das gilt für den Check und für die Jobs des Workflows.
- Gebündelt wird ohne eigene Wartezeit.
- Die Zusicherung bleibt: Grün heißt, der Kopf kompiliert mit dem Ziel-Branch, der beim Melden gilt (Ausnahme wie bisher: nur Release-Commits weiter).

**Non-Goals:**
- Kein gemeinsamer Lauf aller PRs, das ist LLH-1890.
- Keine neue Befundart im Stau-Wächter.

## Decisions

**D1 Warteschlange statt Abbruch.** `cancel-in-progress: false` für alle Ereignisse. GitHub hält je Gruppe einen laufenden und einen wartenden Lauf und ersetzt den wartenden durch den jüngsten. Bei fünf Merges in zehn Minuten bleiben das höchstens zwei Läufe je PR.
- *Alternative Debounce* (`verteilen` wartet etwa 3 min): Jedes Ergebnis käme 3 min später, und es gäbe zusätzliche Logik. Ruben hat am 14.11. die Warteschlange ohne Debounce gewählt.
- *Alternative Abbruch nur bei neuem PR-Kopf:* Den Fall schließt ein Wettlauf nicht aus. Ein Einzellauf zum neuen Kopf kann vor dem PR-Ereignis starten und würde dann abgebrochen, mit roten Jobs am Kopf. Verworfen. Der Preis dafür ist, dass ein Push an einen rechnenden PR bis zu einem Lauf länger wartet.

**D2 Kein Check wird wegen Überholung geschlossen.** Ein überholtes Ergebnis lässt den eigenen Check `in_progress` und setzt nur den Text auf „Überholt“. Der Einzellauf legt weiter einen frischen Check an, schließt den von `verteilen` aber nicht mehr.

**D3 Maßgeblich ist der jüngste Check, ein überholter wartet auf ihn.** Alle Runs der Checks-API liegen in einer Check-Suite, und GitHub wertet je Name den jüngsten. Gemessen am 14.11. an rund 45 PR-Köpfen: Gemergte PRs trugen ältere Runs, die noch auf `in_progress` standen. Ältere offene Checks stören also nicht und bleiben offen. Ein erster Entwurf schloss sie in `melden` mit. Ohne `filter=all` fand er sie aber nie (Review), und nötig ist das auch nicht. Ein überholter Check wartet bis zu 5 Minuten auf einen jüngeren. Steht danach noch ein Push-Lauf des Workflows aus, weil `verteilen` auf einen Runner wartet, bleibt er auf „läuft“ (`melden` liest dafür Actions). Erscheint keiner und steht keiner aus, etwa weil nur ein Release-Commit kam und der Vergleich scheiterte oder `verteilen` abbrach, wird er rot mit „neu starten“ (Rubens Wahl am 14.11.). Hat sich der PR-Kopf bewegt, wartet er nicht: Der Check steht am alten Kopf, den der PR nicht mehr zeigt.
- *Alternative Stau-Wächter-Befund „hängt auf läuft“:* Mehr Code und eine spätere Meldung. Verworfen.
- *Alternative: den Check von `verteilen` im Einzellauf wiederverwenden.* Geht nicht. Ein inzwischen abgeschlossener Check müsste wieder geöffnet werden, und ein jüngerer verwaister Check aus einem PR-Ereignis bliebe stehen.

**D5 Ein schon gerechneter Stand rechnet nicht noch einmal** (Review). Der wartende Lauf liest die Spitze des Ziel-Branches erst bei seinem Start. Liegt ein Merge kurz vor diesem Start, rechnet er schon gegen den neuen Stand, bevor `verteilen` dafür dispatcht hat. Der Dispatch würde dann einen dritten Lauf gegen denselben Stand einreihen. Deshalb trägt jeder Check den gerechneten Ziel-Stand in `external_id`. Der Einzellauf übernimmt ein abgeschlossenes Ergebnis (grün oder rot) zu genau diesem Kopf und Stand in den Check von `verteilen` und rechnet nicht. Er bekommt dafür den Kopf mit, auf dem `verteilen` den Check angelegt hat. Hat der PR inzwischen einen neuen Kopf, übernimmt er nichts. Nicht übernommen wird außerdem (Nachreview): bei einem Neustart des Laufs (`GITHUB_RUN_ATTEMPT` > 1), denn wer neu startet, will neu rechnen; und ein „Kein Ergebnis“ oder „Überholt, kein neuer Lauf“. Diese Checks verlieren ihre `external_id`. Die Fehlerausgabe wird mit übernommen.

**D4 Fehlschläge bleiben rot.** Lässt sich der Einzellauf nicht starten, bleibt das Verhalten unverändert (422/404 → `failure` mit Rat, vorübergehender Fehler → `cancelled`). Dort liegt tatsächlich ein Fehler vor.

## Risks / Trade-offs

- [Ein Lauf hängt (Runner-Ausfall), sein Check bleibt auf „läuft“] → Wie bisher. Der nächste Anstoß (Commit, Merge, Auto-Merge an) legt einen jüngeren Check an, der ihn ablöst.
- [Längere Wartezeit nach einer Merge-Serie, bis zu zwei Laufzeiten] → Gewollt, als Preis für „kein Rot“. Messen in LLH-1890.
- [Ältere Runs bleiben in der Liste mit `filter=all` auf `in_progress`] → Rein kosmetisch. Weder die PR-Ansicht noch der Required Check werten sie.

## Migration Plan

Ein PR-Ereignis-Lauf liest den Workflow aus dem Merge-Ref, nach dem Merge also schon die neue Fassung. Ein Einzellauf von `verteilen` liest ihn aus dem PR-Branch und bekommt dort bis zum Hineinmergen von `alpha` die alte Fassung mit `cancel-in-progress: true`. Beide teilen sich die Gruppe. Ein alter Einzellauf bricht dann einen neuen PR-Ereignis-Lauf ab, und der PR zeigt abgebrochene Jobs wie bisher. Die alte Fassung ruft zudem `einzellauf` mit fünf statt sechs Argumenten auf. Das scheitert nicht, weil die alte Fassung auch ihr eigenes Skript aus dem PR-Branch nimmt. Beim Ausrollen deshalb `alpha` in jeden offenen fertigen PR mergen. Erst danach gilt das neue Verhalten durchgehend. Zurückrollen: den Commit zurücknehmen.
