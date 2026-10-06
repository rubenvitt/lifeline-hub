## Why

An vier Stellen standen Status- oder Bedienfarben außerhalb ihres Sinns: ein gelber Farbpunkt im
Gliederungsbaum für „kein Leiter eingetragen“ (las sich wie „angespannt“), Rot an jeder Besatzung,
die niemand dem Fahrzeug zugeordnet hat, Rot an „Sofortmeldung“ und „Bestätigen“ (beide löschen
nichts) und Rot am planmäßigen Endzustand „aufgelöst“ von UHS und Bereitstellungsraum. Das
verbraucht die Alarmfarbe; eine echte Unterbesetzung oder Gefahr fällt nicht mehr auf.

## What Changes

- Gliederungsbaum: sichtbarer Chip „ohne Leiter“ statt Farbpunkt, Lagezustand als `StatusTag`
  wie im Überblick.
- Fahrzeuge: neue Vertragskarte `besatzungsUrteil` (nicht erfasst, kein Soll, erfüllt,
  unterbesetzt); Rot nur bei echter Unterbesetzung, Ist und Soll beschriftet.
- Meldungen: „Sofortmeldung“ ohne `danger`, „Bestätigen“ als Primärknopf.
- `uhsStatus.aufgeloest` und `brStatus.aufgeloest` `neutral`.
- Legende der Statusraster über den Zeilen (Überblick) bzw. im Spaltenkopf „Fahrzeuge und
  Personal“ (Meldebild).

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `farbrollen-kontrast`: Rot steht nur für den abnormen Zustand, jede Statusfarbe mit sichtbarem
  Wort.

## Impact

Nur Frontend: `theme/statusFarben.ts`, `pages/einsatzabschnitte/AbschnittKnoten.tsx`,
`pages/FahrzeugePage.tsx`, `pages/fuehrung/UeberblickPage.tsx`, `pages/KraefteuebersichtPage.tsx`,
`meldungen/MeldungFormular.tsx`, `meldungen/MeldungKarte.tsx`, Guard
`components/aktionsabstand.guard.test.ts`, neue e2e `e2e/farbvertrag-wort.spec.ts`.
