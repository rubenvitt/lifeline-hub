# Proposal

## Why

Das Zeitachsen-Band der Lagekarte (`SnapshotLeiste.tsx`) ist der letzte Baustein über der Karte mit
festen Abständen (LFH-703, Entscheidung 01.10.2026). Mit den Abständen der Dichte-Staffel risse es im
Handschuh-Betrieb den Deckel der halben Kartenhöhe (`e2e/leisten-flaeche.spec.ts`). Gemessen auf
`alpha` (04.10.2026) steht es dort schon mit festen Abständen bei 282 von 582 px am Handschirm und
282 von 579 px am Tablet, also bei 49 %. Die Höhe treiben drei Reihen à 72 px: Sichern (Feld und
Knopf), Zeitleiste (Aktuell, Abspielen, Schieber, Beschriftung) und die Knopfreihe der Stände. Erst
wenn das Band strukturell flacher wird, dürfen seine Abstände mit der Staffel wachsen.

## What Changes

- Die Knopfreihe der Stände, die Beschriftung neben dem Schieber und der Knopf „Aktuell“ gehen in
  **eine Auswahl „Stand“** auf. Sie zeigt den angezeigten Stand („Live“ oder die Bezeichnung) und
  bietet „Live“ und alle gesicherten Stände an, die neuesten oben. Den Rückweg in den Live-Modus
  tragen die Auswahl und weiter das Historien-Banner („Aktuell“).
- **„Stand sichern“** wird ein Symbolknopf (Kamera, zugänglicher Name „Stand sichern“). Er öffnet
  einen kurzen Dialog mit dem optionalen Feld „Bezeichnung“ und dem Knopf „Sichern“; Enter sichert.
  Das Feld steht nicht mehr dauerhaft im Band.
- Das Band besteht aus **zwei Gruppen**: Wiedergabe (Ausblenden, Abspielen, Schieber) und Stand
  (Auswahl, Sichern). Jede Gruppe bleibt in einer Zeile; reicht die Breite nicht für beide, steht
  die Stand-Gruppe in einer zweiten Zeile. So hat das Band höchstens zwei Reihen.
- Die festen Abstände `BAND_LUECKE`, `BAND_POLSTER`, `STAND_LUECKE`, `ZEITLEISTE_LUECKE` und
  `SCHIEBER_RAND` fallen weg. Lücke zwischen den Gruppen `margin`, Lücke in der Gruppe `marginSM`,
  Polsterung `paddingSM`, Rand des Schiebers `marginXS`.
- Die Ausnahme für das Band im Kopf von `leistenAbstand.guard.test.ts` wird gestrichen.
- Der Deckel-Test prüft zusätzlich: im Handschuh-Betrieb stehen die Bedienziele im Band mindestens
  16 px auseinander, für Admin und Beobachter.

## Capabilities

### New Capabilities

- `lagekarte-zeitachse`: Bedienung des Zeitachsen-Bands der Lagekarte, also Stand wählen, Stand
  sichern, Rückweg in den Live-Modus und der Aufbau aus zwei Gruppen mit höchstens zwei Reihen.

### Modified Capabilities

- `einsatztauglichkeit-layout`: Die Anforderung „Das Zeitachsenband der Lagekarte lässt die Karte
  sichtbar“ bekommt die Abstände aus der Dichte-Staffel und den Zielabstand von mindestens 16 px im
  Handschuh-Betrieb dazu.

## Impact

- Frontend: `pages/lagekarte/SnapshotLeiste.tsx` (Umbau), `SnapshotLeiste.test.tsx`,
  `leistenAbstand.guard.test.ts` (Kopf), `pages/lagekarte/AGENTS.md` (ein Absatz zum Band).
- e2e: `leisten-flaeche.spec.ts` (Anker auf die Auswahl, Zielabstand), `gate3-trefflaeche.spec.ts`
  (Zeitachse: Auswahl und Symbolknöpfe statt beschrifteter Knöpfe), `lagekarte-smoke.spec.ts`
  (Stand-Wahl über die Auswahl, Reihenzahl), `fokus-verdeckung.spec.ts` nur, falls ein Anker bricht.
- Kein Backend, keine Wire-, Codegen-, Migrations- oder Rechteänderung. Die Schreibsperre des
  Beobachters bleibt: ohne Schreibrecht kein Sichern-Knopf.
