# Tasks

## 1. Auswahl „Stand“ (D1)

- [x] 1.1 Vitest zuerst: die Auswahl „Stand“ bietet „Live“ und die Stände absteigend nach `stand_at` an, zeigt den aktiven Stand, ruft bei Wahl `onWaehle(id)` bzw. `onWaehle(null)` und hält eine laufende Wiedergabe an; im Band gibt es keine Stand-Knöpfe und keinen Knopf „Aktuell“ (`SnapshotLeiste.test.tsx`, rot gesehen)
- [x] 1.2 `SnapshotLeiste.tsx`: Knopfreihe, Beschriftung und „Aktuell“ durch die Auswahl ersetzen (Optionen absteigend, `chipLabel`, `notiz` als `title`); Nachweis 1.1 grün

## 2. Sichern über den Dialog (D2)

- [x] 2.1 Vitest zuerst: „Stand sichern“ ist ein Symbolknopf mit genau diesem Namen, öffnet den Dialog, Enter und „Sichern“ rufen `erzeugeLageSnapshot` mit der Bezeichnung, Erfolg schließt und leert, Fehler lässt offen; ohne Schreibrecht kein Knopf (`SnapshotLeiste.test.tsx`, rot gesehen)
- [x] 2.2 `SnapshotLeiste.tsx`: Feld aus dem Band in ein `Modal` „Stand sichern“ verlegen; Nachweis 2.1 grün

## 3. Zwei Gruppen und Staffel-Abstände (D3, D4)

- [x] 3.1 Vitest zuerst: exportierte Gruppenstile halten `flexWrap: 'nowrap'`; Lücken und Polsterung kommen aus dem Token (Probe mit `handschuh`-Token: Gruppenlücke 26, Lücke in der Gruppe 16, Polsterung 16) (`SnapshotLeiste.test.tsx`, rot gesehen)
- [x] 3.2 `SnapshotLeiste.tsx`: Gruppen Wiedergabe (Ausblenden, Abspielen, Schieber) und Stand (Auswahl, Sichern) bauen, Konstanten `BAND_LUECKE`, `BAND_POLSTER`, `STAND_LUECKE`, `ZEITLEISTE_LUECKE`, `SCHIEBER_RAND` und ihren Begründungsblock streichen; Nachweis 3.1 grün, `leistenAbstand.guard.test.ts` grün
- [x] 3.3 Ausnahmeabsatz zum Zeitachsen-Band im Kopf von `leistenAbstand.guard.test.ts` streichen; Guard grün
- [x] 3.4 `pages/lagekarte/AGENTS.md`: ein Absatz zum Band (Auswahl statt Knopfreihe, zwei Gruppen, Abstände aus der Staffel, Spec `lagekarte-zeitachse`); Prettier grün

## 4. Browser-Nachweise

- [x] 4.1 `e2e/leisten-flaeche.spec.ts`: Anker auf die Auswahl umstellen; Zielabstand ≥ 16 px in `handschuh` und höchstens zwei Reihen für Admin und Beobachter ergänzen; beide Zeitachsen-Tests grün über alle Flächen und Stufen, Messwerte im Lauf notiert
- [x] 4.2 `e2e/gate3-trefflaeche.spec.ts`: Zeitachse misst die Auswahl als beschriftetes Ziel, Ausblenden/Abspielen/Stand sichern als Symbolknöpfe; Test grün
- [x] 4.3 `e2e/lagekarte-smoke.spec.ts`: Stand über die Auswahl wählen und zurück auf „Live“; Reihenprüfung auf die neue Höhe (zwei Reihen mit Staffel-Lücke); Test grün
- [x] 4.4 `e2e/fokus-verdeckung.spec.ts` (Zeitachse) und `e2e/lagekarte-touch.spec.ts` laufen grün, ohne Anpassung oder mit nachgezogenem Anker

## 5. Abschluss

- [x] 5.1 `./scripts/check-all.sh` grün (lokal: Bündel `schnell`, `frontend`, Lagekarten-e2e; die CI des PRs belegt den vollen Lauf)
- [x] 5.2 Code-Review angefordert und Befunde abgearbeitet
