# Tasks

## 1. Eine Quelle für den Wortlaut

- [x] 1.1 `pages/gefahren/beurteilung.ts`: `UNBESTAETIGT = 'unbestätigt'` und `BESTAETIGT = 'bestätigt'` statt `NICHT_BEURTEILT`; `beurteilungText` liefert „bestätigt <DTG> · Name“ bzw. „unbestätigt“. Test zuerst in `beurteilung.test.ts` (rot), dann grün.
- [x] 1.2 Abnehmer umstellen: `GefahrenBeurteilung.tsx` (Kopfchip und Stand mit `BESTAETIGT`), `lageVerdichtung.ts` (Fuß „<Gebiet>: unbestätigt“, „<n> Gebiete unbestätigt“), `ueberblickDaten.ts` und `UeberblickPage.tsx` („1 unbestätigt“), `schadenlageUebernahme.ts` („(unbestätigt)“), Druckkopf über `beurteilungText`. Tests `lageVerdichtung`, `ueberblickDaten`, `UeberblickPage`, `GefahrenBeurteilung`/`GefahrenPage`, `schadenlageUebernahme`, `GefahrengebietVorschau` auf den neuen Wortlaut; `mise exec -- pnpm -C frontend test` für diese Dateien grün.
- [x] 1.3 Rest-Grep: `git grep -n "nicht beurteilt" frontend/src/pages/gefahren frontend/src/pages/lage-dashboard frontend/src/pages/fuehrung frontend/src/lageberichte frontend/src/command-palette` trifft nur noch den Lagezustand eines Abschnitts (`ueberblickDaten.ts` Ordnung der Lagezustände) bzw. nichts.

## 2. Gebietsliste: Stufe und Zusatz in einem Etikett

- [x] 2.1 Reine Funktion `gebietEtikett(gebiet)` neben `gebietAussage`: Darstellung aus `warnstufeKarte[stufe]`, bei unbestätigt Wortlaut „<label> · unbestätigt“ (Rolle und Form unverändert); `gebietAussage` liefert für unbestätigt `null`. Tests in `gebietAussage.test.ts`: „hoch · unbestätigt“, „keine · unbestätigt“, bestätigt unverändert „2 Gefahren · hoch“.
- [x] 2.2 `GefahrenPage.tsx` nimmt `gebietEtikett` für den `StatusTag`; Seitentest prüft für ein unbestätigtes Gebiet das Etikett „hoch · unbestätigt“ und das Fehlen von „nicht beurteilt“.

## 3. Spec-Text, e2e und Anwenderdoku

- [x] 3.1 e2e und Bildlauf auf den Wortlaut: `gefahren-druck.spec.ts` („Beurteilung unbestätigt“), `gate3-trefflaeche.spec.ts`, `trefflaeche-pruefflaechen.spec.ts`, `doku-bilder/gefahren.bilder.ts`, `doku-bilder/lagebild.bilder.ts`; `git grep "nicht beurteilt" frontend/e2e` trifft nur noch Abschnitts-Lagezustände.
- [x] 3.2 Purpose der Hauptspec `openspec/specs/gefahrenmatrix/spec.md` auf „bestätigt … / unbestätigt“ nachziehen (die Delta trägt nur die Requirements); `mise exec -- openspec validate rs1ar18w-gefahren-unbestaetigt --strict` grün.
- [x] 3.3 Anwenderdoku `gefahren.md`, `lagebild.md`, `ueberblick.md`, `lageberichte.md` auf „unbestätigt“/„bestätigt“ (nicht `einsatzabschnitte.md`, dort ist der Lagezustand gemeint); betroffene Bilder über den Bildlauf neu erzeugen; Doku-Wächter (`check-all.sh`, Bündel der Anwenderdoku) grün.

## Workflow follow-up

- Gemeinsamer Review vor dem PR über den ganzen Branch (Welle 1 von LLH-1717).
- `/opsx:archive rs1ar18w-gefahren-unbestaetigt` vor dem PR, im selben Branch.
