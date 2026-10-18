# Proposal

## Why

Rubens App-Durchgang vom 10.10.2026 (Zunder LLH-1018, Subtask LLH-1133): „UHS im Grundsatz gut.
Das Material ist sehr versteckt.“ Auf der UHS-Detailseite füllt der Grundriss das ganze Fenster.
Die Reiter „Material · Kräfte · Bewegungen · Dateien“ hängen darunter im Seitenfluss, und bei
1440 × 900 sieht man von ihnen nur den oberen Rand. Im Kopf steht keine Materialzahl. Den Status
(defekt, verbraucht) setzt nur das Modul Material, und Material ad hoc erfassen geht aus der UHS
nicht.

## What Changes

- **Bereichsleiste oben:** Eine `Segmentleiste` direkt unter dem Seitenkopf mit „Belegung ·
  Material · Kräfte · Bewegungen · Dateien“. „Belegung“ ist der Grundriss und die Vorgabe und
  behält die volle Fensterhöhe. Die anderen Bereiche nehmen dieselbe Fläche ein. Die Wahl steht
  in der URL (`?bereich=material`).
- **Zahl im Kopf:** Die Meta-Zeile nennt die Materialzahl im Wortlaut des Bausteins
  („8 Posten · 1 Ausfall“, eine Heimat je Zahl) als Sprung in den Bereich.
- **Status am Ort setzen:** Die Statusanzeige eines Postens ist der Auslöser (Muster
  `StatusWahl`). Das gilt in jedem Ort, der `MaterialAmOrt` nutzt (UHS, Einheit, Fahrzeug, BR).
- **„Material erfassen“ am Ort:** Ad-hoc-Material wird mit Zuordnung zum Ort in einem Schritt
  erfasst. Der Server kann das schon (LLH-1224), der Verweis „im Modul Material erfassen ↗“
  entfällt.
- **„Fehlmenge melden“** springt in die Nachforderung, vorbelegt mit Art Material und dem Ort.
- Die Unterreiter des Grundrisses unter `xl` (Fläche/Wartebereich/Transport) bleiben eine Ebene
  tiefer.

## Capabilities

### New Capabilities
<!-- keine -->

### Modified Capabilities
- `material-am-ort`:
  - „Material am Ort zeigen“ nennt den UHS-Bereich statt des Reiters.
  - neu „Status am Ort setzen“, „Material am Ort erfassen“, „Fehlmenge vom Ort melden“
- `uhs-grundriss`: neu „Die UHS-Seite gliedert sich in Bereiche“ (Bereichsleiste, URL, volle
  Höhe für jeden Bereich).

## Impact

- Frontend:
  - `pages/uhs/UhsDetailPage.tsx`, `pages/uhs/MaterialTab.tsx`, `kraefte/MaterialAmOrt.tsx`
    samt Tests (`materialSchreibweg.test.tsx`), `kraefte/materialPosten.ts`
  - der Ad-hoc-Dialog wird aus `pages/MaterialPage.tsx` herausgelöst
  - `routing/deeplinks.ts` (`bereich`)
- e2e: `uhs-hoehe.spec.ts` (Höhenkette).
- Doku: Kapitel `unfallhilfsstellen.md` (Bild `grundriss.png`) und `material.md`.
- Kein Backend, kein Codegen.
- Zunder: https://zunder.rubeen.dev/#/aufgabe/i0x7xjk3h893kfm53a01ba9w
