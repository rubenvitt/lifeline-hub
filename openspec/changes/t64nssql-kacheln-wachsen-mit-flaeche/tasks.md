# Tasks

Zunder: https://zunder.rubeen.dev/#/aufgabe/t64nssql5sboyz6yh03bdptn

## 1. Einpassfaktor rechnen

- [x] 1.1 `einpassFaktor` und `grundrissInhalt` (Hülle aus Plätzen und Plan in Grundmaßen) in
  `frontend/src/pages/uhs/grundrissLayout.ts` per TDD anlegen (design.md D1); Tests in
  `grundrissLayout.test.ts` für: leere Fläche → 2, volle Fläche → 1, dazwischen abgerundet auf
  zwei Stellen, Maß 0 oder kein Platz → 1, Plan erweitert die Hülle, Mindestfläche 700 × 420
  zählt nicht. Nachweis: `mise exec -- pnpm exec vitest run src/pages/uhs/grundrissLayout.test.ts`
  grün, vorher rot.

## 2. Grundriss streckt

- [x] 2.1 `flaecheMessen` misst zusätzlich `clientWidth`/`clientHeight` des Bildlauf-Containers;
  der Grundriss bildet daraus `s` und hält ihn während eines Zugs fest (D2, D4). Nachweis:
  Vitest-Test in `Grundriss.test.tsx` mit gestubbtem `ResizeObserver`/`clientWidth`, der eine
  doppelt so große Karte und Position erwartet, rot → grün.
- [x] 2.2 `PlatzKarte` und `PlanEbene` bekommen `s`: `left`/`top`, Breite und Höhe der Karte, Lage,
  Breite und Höhe des Plans und die Innenfläche werden gestreckt, Rand, Polster und Inhalt nicht
  (D3). Nachweis: Test aus 2.1 und ein Test für die Planlage grün; bestehende Grundriss-Tests
  bleiben grün.
- [x] 2.3 `onDragEnd` rechnet die Zugstrecke mit `1/s` gerundet zurück (D4). Nachweis: Test, der
  bei `s = 2` einen Tastatur- oder gestubbten Zug um 200 px auslöst und `pos_x + 100` an
  `aktualisierePlatz` erwartet, rot → grün.
- [x] 2.4 Kommentare an `PLATZ_KARTE_*`, am Hinweis „feste 140 × 116 px“ über der Fläche und in
  `src/uhs/plan.rs` (`KARTE_BREITE`/`_HOEHE`) auf „Grundgröße“ nachziehen (D6). Nachweis:
  `grep -n "feste 140" frontend/src/pages/uhs/Grundriss.tsx` leer.

## 3. Im Browser belegen

- [ ] 3.1 e2e in `frontend/e2e/uhs-grundriss-layout.spec.ts`: Grundriss mit wenigen Plätzen bei
  1920 × 1080 → Karten breiter als 140 px und nicht angeschnitten; Dichtestufe „Handschuh“ →
  dieselbe Kartengröße und Position wie „kompakt“; Zug im Bearbeiten-Modus landet an der
  losgelassenen Stelle. Nachweis: die Spec läuft lokal grün.
- [ ] 3.2 Bestehende Suiten zu Grundriss und Plan (`uhs-grundriss-*.spec.ts`, `uhs-plan.spec.ts`,
  `geraet-uhs-*.spec.ts`) lokal fahren. Nachweis: grün oder Abweichung mit Grund in der PR-Beschreibung.

## 4. Doku

- [ ] 4.1 `docs/anwender/kapitel/unfallhilfsstellen.md`: ein Satz, dass die Plätze mit der freien
  Fläche bis auf das Doppelte wachsen und gespeicherte Positionen dabei gleich bleiben; Bilder
  des Kapitels neu erzeugen (`pnpm doku:bilder e2e/doku-bilder/unfallhilfsstellen.bilder.ts`).
  Nachweis: `mise exec -- pnpm exec vitest run src/hilfe/anwenderdoku.guard.test.ts` grün.

## 5. Gate

- [ ] 5.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün.

## Workflow follow-up

- Change vor dem PR archivieren (`/opsx:archive`), Spec-Sync nach `openspec/specs/uhs-grundriss/`.
- Bilder der Änderung (vorher/nachher) in PR und Meldung.
