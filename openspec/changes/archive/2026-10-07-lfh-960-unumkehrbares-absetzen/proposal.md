## Why

Der Abschluss des ganzen Einsatzes steht heute rot im Kopf des Einsatztagebuchs, neben „Drucken /
als PDF“ und dem Typfilter; am Handy steht er im Menü „Weitere“ der Zeitachse. Die Rückfrage
bestätigt mit „Ja“. Wer am Führungs-Tablet mit Handschuh daneben tippt und reflexhaft bestätigt,
schließt den Einsatz für alle, und das Frontend kennt keinen Rückweg. Bei Unfallhilfsstellen und
Bereitstellungsräumen bestätigen „Auflösen“ und „Stornieren“ mit antds „OK“, und im Kopf eines
geplanten Bereitstellungsraums steht „Stornieren“ mit 3 bis 7 px neben „In Betrieb nehmen“.

Entschieden am 06.10.2026 (Klärungsrunde Welle 4, Frage 5, Option A): der Abschluss wandert auf
die Einsatzdaten, nur für die Einsatzleitung, mit benanntem rotem Bestätigungsknopf, ohne
Eintippen der Einsatzbezeichnung.

## What Changes

- **Neue Regel** in `frontend/AGENTS.md`, „Destruktiv ist nicht gleich destruktiv“:
  Unumkehrbares für den ganzen Einsatz steht nicht im Kopf und nicht im Menü einer Arbeitsseite.
- **Einsatzabschluss** verlässt das Einsatztagebuch (Kopf und Menü „Weitere“) und steht auf den
  Einsatzdaten als eigener letzter Abschnitt „Einsatzabschluss“, nur für die Einsatzleitung eines
  aktiven Einsatzes. Rückfrage `Popconfirm` mit Bestätigungsknopf „Einsatz endgültig abschließen“
  (`danger`), die Folge bleibt als Beschreibung. Das ETB trägt keinen Hinweis.
- **Benannte Rückfragen** bei UHS und BR: „Unfallhilfsstelle auflösen“, „Unfallhilfsstelle stornieren“, „BR auflösen“,
  „BR stornieren“.
- **BR-Kopf** mit `<Space wrap size="middle">`; `BrDetailPage.tsx` kommt in den Abstands-Guard.
- **Rückfrage-Guard** über alle `<Popconfirm>` mit `danger`-Bestätigung: der Bestätigungsknopf
  trägt einen eigenen Text, nie „Ja“ oder „OK“. Die übrigen Stellen, die heute noch ohne Text
  sind, stehen als Schuldliste im Guard und werden in einem Folgeticket umgestellt.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `bedien-wortlaut`: Unumkehrbares für den ganzen Einsatz steht nicht auf einer Arbeitsseite; ein
  Guard prüft die Bestätigungsknöpfe der roten Rückfragen.

## Impact

- Frontend: `pages/EtbPage.tsx`, `pages/EinsatzdatenPage.tsx`, `pages/uhs/UhsDetailPage.tsx`,
  `pages/bereitstellungsraum/BrDetailPage.tsx`, `components/aktionsabstand.guard.test.ts`, neuer
  Guard `components/rueckfrage.guard.test.ts`, `frontend/AGENTS.md`.
- Tests: `EtbPage.abschliessen.test.tsx`, `EtbPage.test.tsx`, `EinsatzdatenPage.test.tsx`,
  `UhsDetailPage.test.tsx`, `BrDetailPage.test.tsx`; e2e für ETB und Einsatzdaten an vier Breiten,
  Einsatzleitung und nicht-privilegiert.
- Backend unverändert (`POST /api/einsaetze/{id}/abschliessen` bleibt).
