# Proposal

## Why

Rubens App-Durchgang vom 10.10.2026 (Zunder LLH-1018, Subtask LLH-1083) hat gezeigt: Die
Sichtung lässt sich schlecht wählen. In der Erfassung steckt ein kleines Farbquadrat in einem
Rahmen in einem zweiten Rahmen, und der gewählte Zustand ist nur ein dickerer blauer Rand. Die
Nachsichtung ist ein Dropdown ohne Farbe, das drei Tipps braucht. Im Massenanfall wird in
Sekunden gesichtet, oft mit Handschuhen, bei Nacht oder in der Sonne. Eine Fehlwahl verschiebt
Behandlungs- und Transportpriorität.

## What Changes

- Neuer Baustein **`SichtungsWahl`**: Jede Kategorie ist eine große BBK-Farbfläche. Darin steht
  das Kürzel groß und das Bedeutungswort klein. „unverletzt“ ist eine neutrale Fläche mit Rahmen.
  Die Reihenfolge ist SK I, SK II, SK III, SK IV, tot, unverletzt.
- **Flächenpalette** neben den Punktfarben (Entscheidung Ruben, Option B): Rot `#a8071a`,
  Gelb `#fadb14`, Grün `#135200`, Blau `#003eb3`, Schwarz `#000000`. Gelb trägt schwarze Schrift,
  alle anderen weiße. Jede Fläche trägt eine Kante in der Textfarbe des Modus.
- **Aktivzustand mit zweitem Kanal:** Die gewählte Fläche bleibt gefüllt und trägt ✓ und einen
  kräftigen Rahmen. Die übrigen fallen in eine Randform zurück und bleiben wählbar. Dazu kommen
  `radiogroup`/`radio` mit `aria-checked`, Pfeiltasten und Leertaste.
- **Trefferfläche:** in jeder Dichte mindestens 72 px hoch und 96 px breit. Der Abstand ist
  ≥ 8 px in `kompakt` und ≥ 16 px in `komfortabel`/`handschuh`.
- **Einbau:** Die Erfassung (Modal, Aufnahme-Seite, UHS-Tablet) ersetzt ihre `Radio.Group`, eine
  Wahl lässt sich dort zurücknehmen. Die Nachsichtung ersetzt das `Select`: Fläche tippen, dann
  „Übernehmen“. Die lesende Anzeige `SichtungsTag` bleibt unverändert.
- **Regel:** `frontend/AGENTS.md`, „Farbachsen → Sichtung“: Gewählt wird als Vollfläche über
  `SichtungsWahl` aus der Flächenpalette, angezeigt wird weiter als umrandetes Farbfeld.

## Capabilities

### New Capabilities
- `sichtungswahl`: wie eine Sichtungskategorie gewählt wird. Das umfasst Flächen, Aktivzustand,
  Abwahl, Tastatur und Hilfstechnik, Trefferfläche und die Zahl der Tipps einer Nachsichtung.

### Modified Capabilities
- `farbrollen-kontrast`: neue Anforderung „Sichtungsfläche hält den Textboden“. Sie umfasst
  Text auf jeder Fläche (Tag ≥ 7 : 1, Nacht ≥ 5 : 1) und die Kante gegen den Grund (≥ 3 : 1) in
  beiden Modi.

## Impact

- Frontend:
  - neu `personen/SichtungsWahl.tsx` mit Test
  - `personen/AufnahmeFelder.tsx`, `personen/SichtungDialog.tsx`, `personen/personMeta.ts`
    (`SK_REIHE` exportiert)
  - `theme/tokens.ts` (`sichtungsflaechen`), neuer Test `theme/sichtungKontrast.test.ts`
  - e2e: `betroffene-kontrast.spec.ts`, `trefflaeche-pruefflaechen.spec.ts`
- Regeln: `frontend/AGENTS.md` (Farbachsen), `frontend/src/personen/AGENTS.md`.
- Doku: Kapitel `betroffene.md` und `geraet-uhs.md`, Bilder der Erfassung und der Nachsichtung.
- Kein Backend, keine Migration, kein Typ-Codegen.
- Zunder: https://zunder.rubeen.dev/#/aufgabe/knc0jyjdmfnmor1fo5ovy89g
