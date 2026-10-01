# Proposal

## Why

Die Notiz einer Kennzahl bricht um, sobald sie länger wird, und das Kennzahlenband „Lage in
Zahlen“ wächst dann um diese Zeile. Gefahrenmatrix, Sichtung und Meldungsstrom darunter
rutschen nach unten. Kommt die erste Standmeldung, fällt „· 1 ohne Meldung“ weg, und alles
springt wieder hoch. Das verletzt Kriterium 12 der Prüfliste („kein Sprung unter dem Cursor“,
offen aus LFH-607, `openspec/changes/archive/2026-09-29-lfh-607-kennzahl-evakuiert/pruefliste.md`).
Die Ursache steckt im Baustein `Kennzahl`: oberhalb von `md` hat die Notiz keine feste
Zeilenzahl.

Die Messung im Browser (Viewport-Stufe `xl`, Zellbreite 146 / 186 / 266 px bei 1200 / 1440 /
1920 px) zeigt, dass „Evakuiert“ nicht der längste Fall ist:

| Notiz | 1200 | 1440 | 1920 |
| --- | --- | --- | --- |
| „von 1 850 geplant · 1 ohne Meldung“ | 2 | 2 | 1 |
| „von 1 850 geplant“ (nach der Meldung) | 1 | 1 | 1 |
| Pegel „WESER · steigend +9 cm/h · Stand 11:57“ | 2 | 2 | 1 |
| Pegel mit „· Prognose 7,10 m bis 16:57 · +1 weitere“ | 4 | 3 | 2 |

Bandhöhe nach Zeilen der längsten Notiz: 89,5 (1) · 104,9 (2) · 120,3 (3) · 135,7 (4) px. Die
Pegel-Notiz wächst und schrumpft mit Prognose, „veraltet“ und „+n weitere“, das Band springt
also auch ohne Evakuierung.

## What Changes

- **Fester Notizplatz ab `md`:** Ein Kennzahlenband kann für seine Notizen eine feste
  Zeilenzahl anfordern. Ab `md` ist jede Notiz des Bands dann genau so hoch, als Boden und als
  Deckel. Ist eine Notiz länger, endet die letzte sichtbare Zeile mit „…“.
- **Nichts geht verloren:** Der volle Text bleibt im DOM, der zugängliche Name des Links liest
  ihn also ganz. Eine gekürzte Notiz trägt ihn zusätzlich im `title`, für den Mauszeiger.
- **Drei Zeilen für „Lage in Zahlen“:** Das Lage-Dashboard und Führung · Überblick fordern drei
  Zeilen an (Entscheidung am Checkpoint, 01.10.2026). Damit passen ab 1440 px alle gemessenen
  Notizen ganz. Bei 1200 px kann nur das Ende der längsten Pegel-Notiz („+n weitere“) in den
  `title` rutschen. Das Band ist dafür immer drei Notizzeilen hoch, also etwa 15 px höher als
  heute im Zweizeilenfall.
- **Unter `md` bleibt LFH-629:** Dort gilt weiter der Boden von zwei Zeilen
  (`notizZeilenSchmal`).
- **Nachweis:** Ein Playwright-Spec misst die Bandhöhe bei 1200, 1440 und 1920 px vor und nach
  einer neuen Standmeldung und zwischen kurzer und langer Pegel-Notiz. Er prüft außerdem, dass
  die Notiz „… ohne Meldung“ ungekürzt sichtbar ist.

## Nicht-Ziele

- Keine neue Formulierung der Notizen; die Pegel-Spec (`lage-wetter-pegel`) bleibt unberührt.
- Das Band „Führungsstand“ unten im Lage-Dashboard bekommt keinen festen Notizplatz: Unter ihm
  steht nichts, das springen könnte.
- Die übrigen Kennzahlenbänder (Statusband, Meldungen, Bereitstellungsraum, Verpflegung,
  Wetter) bleiben, wie sie sind. Ohne die neue Angabe ändert sich an einem Band nichts.

## Capabilities

### New Capabilities

_Keine._

### Modified Capabilities

- `einsatztauglichkeit-layout`: neue Anforderung „Kennzahlenband hält seine Höhe“. Ab `md`
  ändert sich die Höhe des Bands „Lage in Zahlen“ nicht mit der Länge einer Notiz, und eine
  gekürzte Notiz bleibt vollständig lesbar.

## Impact

- **Frontend:** `frontend/src/components/instrument/Kennzahl.tsx` (Band-Prop, `title` an der
  gekürzten Notiz), `frontend/src/theme/sprache.css` (Regel ab `md`),
  `pages/lage-dashboard/LageDashboardPage.tsx`, `pages/fuehrung/UeberblickPage.tsx`,
  `Kennzahl.test.tsx`.
- **e2e:** neuer Spec `frontend/e2e/kennzahlenband-notizhoehe.spec.ts`.
- **Regeln und Doku:** Bausteinregel „Kennzahlenband“ in `frontend/AGENTS.md`; Kriterium 12 in
  der Prüfliste zu LFH-607 als eingelöst vermerken.
- Kein Backend, keine API, keine Migration.
