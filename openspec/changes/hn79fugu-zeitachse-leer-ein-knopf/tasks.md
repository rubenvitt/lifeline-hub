# Tasks

## 1. Leerzustand: ein Knopf mit Wort

- [x] 1.1 Test zuerst (`SnapshotLeiste.test.tsx`): ohne Stände mit Schreibrecht nur ein Knopf „Stand sichern“ mit sichtbarem Wort, kein „Zeitachse ausblenden“/„einblenden“, auch bei gemerkter Wahl „eingeklappt“ und bei 390 px; linksbündig im Fluss (`alignSelf: flex-start`); öffnet den Dialog. Rot gesehen, dann grün
- [x] 1.2 Zweig in `SnapshotLeiste.tsx` vor `eingeklappt` (D1), Griff `data-lfh="zeitachse-sichern"` (D3); bestehende Tests „bei 390/1024 px nur der Einblenden-Knopf“ laufen weiter mit einem Stand; `pnpm vitest run src/pages/lagekarte/SnapshotLeiste.test.tsx` grün
- [x] 1.3 Mutationsprobe: Zweig entfernt → Test aus 1.1 rot

## 2. Wort am Knopf im Band

- [x] 2.1 Test zuerst: im Band zeigt „Stand sichern“ das Wort als Text (zugänglicher Name ohne `aria-label`), Basisrechnung „Fükw eine Zeile, Tablet nicht“ mit der neuen `standBasis`; rot, dann grün
- [x] 2.2 Wort und `standBasis` in `bandStile` (D2); Breite der Konstante im Browser je Dichtestufe nachgemessen und im Kommentar belegt
- [x] 2.3 `e2e/gate3-trefflaeche.spec.ts`: „Stand sichern“ aus der Regex der Symbolknöpfe nehmen bzw. als beschrifteten Knopf messen; Kommentar Z. 4565 berichtigen

## 3. e2e an den Leerzustand anpassen

- [x] 3.1 Tests, die das ausgeklappte Band ohne Stand voraussetzen, sichern vorher einen Stand per API (mindestens `lagekarte-smoke` erster Test, `lagekarte-touch` mit `einsatzMitLage`/`zeitachseAus`, `lagekarte-werkzeugmenue`, `eingangsband-ausweichen`, `fokus-verdeckung` dort ohne Stand); per `grep 'Zeitachse ausblenden\|Zeitachse einblenden\|data-lfh="zeitachse"'` vollständig abgearbeitet
- [x] 3.2 `e2e/leisten-flaeche.spec.ts`: Leerzustand bei 390 × 844 `handschuh` und 1366 × 768 `kompakt` — kein `[data-lfh="zeitachse"]`, Knopf „Stand sichern“ sichtbar, seine Höhe ist die Höhe der Zeitachse; Mutationsprobe (Zweig entfernt → rot)
- [x] 3.3 Betroffene e2e-Dateien lokal grün (`mise exec -- pnpm exec playwright test <dateien> --trace off`), soweit die Umgebung sie tragen kann; sonst im PR benannt

## 4. Regel, Doku und Gate

- [x] 4.1 `frontend/src/pages/lagekarte/AGENTS.md`, Regel „Das Zeitachsen-Band hat höchstens zwei Reihen“: Satz zum Leerzustand und zum Wort, Verweis auf diese Change; Prettier grün
- [x] 4.2 Doku-Bilder: prüfen, ob `lagekarte.png` u. a. die leere Zeitachse zeigen; wenn ja `pnpm doku:bilder --grep lagekarte` und Bilder committen (Mitänderungsregel `docs/anwender/AGENTS.md`)
- [ ] 4.3 `./scripts/check-all.sh --geaendert --ohne-e2e` grün

## Workflow follow-up

- Bilder der Änderung (vorher/nachher, Fükw und Handschirm) für PR und Meldung aufnehmen.
- `/opsx:archive hn79fugu-zeitachse-leer-ein-knopf` im selben Branch vor dem PR.
