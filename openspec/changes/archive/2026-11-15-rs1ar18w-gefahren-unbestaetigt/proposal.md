# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/rs1ar18w1nx5jvps85w3tkbi (LLH-1745, Teil von LLH-1717
„Was brennt“, Welle 1)

## Why

Ein Gefahrengebiet trägt in der Gebietsliste das Etikett „hoch“ und daneben den Zusatz „nicht
beurteilt“. Gemeint ist „die Bewertung ist noch nicht bestätigt“. Gelesen wird aber „die Stufe ist
nicht bewertet“, und dann widersprechen sich Etikett und Zusatz. Dasselbe Wortpaar steht im
Lagebild („Warnstufe hoch“, Fuß „<Gebiet>: nicht beurteilt“), im Überblick-Kopf und im Druck. Wer die
Lage aus der Entfernung liest, kann nicht sagen, ob „hoch“ gilt.

## What Changes

- Das Wort für eine offene Beurteilung eines Gefahrengebiets heißt überall **„unbestätigt“** statt
  „nicht beurteilt“: Gebietskopf, Gebietsliste, Lagebild-Fuß, Überblick-Kopf, Lagebericht-Übernahme,
  Druckkopf.
- Das Gegenstück heißt **„bestätigt <DTG> · <Name>“** statt „beurteilt <DTG> · <Name>“, passend zum
  Knopf „Beurteilung bestätigen“ und zum ETB-Satz „… bestätigt.“
- In der Gebietsliste steht der Zusatz **im Etikett der Stufe**: „hoch · unbestätigt“, bei Stufe keine
  „keine · unbestätigt“. Der getrennte Zusatz entfällt für ein unbestätigtes Gebiet.
- Unverändert: Die Stufe kommt weiter aus allen gesetzten Zellen (LLH-1090), der Server liefert weiter
  nur `beurteilt_at`. „nicht beurteilt“ für den **Lagezustand eines Abschnitts** ist ein anderer
  Begriff und bleibt.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `gefahrenmatrix`: Wortlaut der Beurteilung („unbestätigt“, „bestätigt <DTG> · <Name>“) in den
  Requirements „Beurteilung je Gefahrengebiet“, „Lagebild und Überblick nennen nicht beurteilte
  Gebiete“ und „Die Gebietsliste sagt, was im Gebiet los ist“; die Gebietsliste führt Stufe und
  Zusatz in einem Etikett zusammen.
- `sprungpalette`: Szenario „Gefahrengebiet mit bewerteten Gefahren“ nennt die Beurteilung mit dem
  neuen Wortlaut (die Vorschau liest dieselbe Quelle). Nachgetragen nach dem Review vor dem PR.
- `lagevortrag-uebernahme`: Requirement „Gefahren je Gebiet in der Gefahren-/Schadenlage“ schreibt
  „(unbestätigt)“ statt „nicht beurteilt“. Nachgetragen nach dem Review vor dem PR.

## Impact

- Frontend: `pages/gefahren/beurteilung.ts` (einzige Quelle des Wortlauts), `gebietAussage.ts`,
  `GefahrenPage.tsx` (Gebietsliste, Druckkopf), `GefahrenBeurteilung.tsx`,
  `pages/lage-dashboard/lageVerdichtung.ts`, `pages/fuehrung/ueberblickDaten.ts`,
  `UeberblickPage.tsx`, `lageberichte/schadenlageUebernahme.ts`, Palettenvorschau
  `GefahrengebietVorschau`, dazu ihre Tests.
- e2e: `gefahren-druck`, `gate3-trefflaeche`, `trefflaeche-pruefflaechen`, Bildlauf `gefahren`,
  `lagebild`.
- Anwenderdoku: `gefahren.md`, `lagebild.md`, `ueberblick.md`, `lageberichte.md` samt Bildern.
- Kein Backend, keine Migration, kein API-Feld.
