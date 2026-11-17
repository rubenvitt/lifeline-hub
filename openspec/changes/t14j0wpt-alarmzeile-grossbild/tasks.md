# Tasks

Jede Aufgabe per `superpowers:test-driven-development`: erst der Test, der ohne die Änderung rot
ist. Pfade relativ zu `frontend/src/`, Läufe in `frontend/` über `mise exec -- pnpm …`.

## 1. Baustein

- [x] 1.1 `components/instrument/AlarmZeile.tsx`: Größe `grossbild` nach design.md D2, mit einem
  Maß-Objekt je Größe (Schrift, Eintragshöhe, Abstand, Innenabstand, Kante als CSS-Länge; bei
  `grossbild` über `grossMass`). Die Werte von `normal` und `gross` bleiben unverändert. Test in
  `AlarmZeile.test.tsx`: Bei `grossbild` gibt es kein `<a>` und keinen Knopf, „+n“ ist ein `span`,
  und die Schrift lautet `grossMass(28)`. `normal` und `gross` behalten ihre Werte.
- [x] 1.2 Karte `AlarmZeile` in `frontend/scripts/design-system/previews.tsx` um die Größe
  `grossbild` ergänzen (Einheit über `--lfh-gross-einheit` festgesetzt), `pnpm design-system` laufen
  lassen und das Erzeugte mitnehmen. Prüfen: `designSystem.guard.test.ts`,
  `schriftLiteral.guard.test.ts` und `gate5.guard.test.ts` sind grün.

## 2. Großbild des Lagebilds

- [x] 2.1 `pages/lage-dashboard/LagebildGrossbild.tsx`: Prop `alarm` (D1) und
  `<AlarmZeile groesse="grossbild" />` als erstes Kind der Fläche (D3). Den Kommentar am Block
  „Stand“ nachziehen. Test: Einträge aus `alarm` stehen in Folge über dem Band „Lage in Zahlen“,
  ohne Link.
- [x] 2.2 `pages/lage-dashboard/LageDashboardPage.tsx`: `alarm={wasBrenntDaten}` übergeben.
  Prüfen: Typecheck grün.

## 3. Ende zu Ende

- [x] 3.1 `e2e/grossbild.spec.ts` (Lagebild, beide Fenster): Die Alarmzeile des Großbilds zeigt
  „1 vermisst“ und „1 Auftrag überfällig“ in Alarmrolle, die kleinste Schrift bleibt bei mindestens
  28 px · Anteil, und `findOverflow` ist leer. Lagebesprechung: Das Großbild enthält keine
  `[data-lfh="alarm-zeile"]`. Den Kopfkommentar der Spec nachziehen. Läuft der Platz nicht aus,
  gilt D3, und eine Abweichung lege ich vorher vor.

## 4. Abschluss

- [x] 4.1 Verweise nachziehen: Regel „Großbild“ in `lagebesprechung/AGENTS.md` (keine Alarmzeile)
  und Liste der Bausteine in `frontend/AGENTS.md` (`AlarmZeile` auch im Großbild des Lagebilds).
- [ ] 4.2 `./scripts/check-all.sh --geaendert --ohne-e2e` und das e2e `grossbild.spec.ts` lokal
  grün; Bilder der Änderung (1920 × 1080 und 1280 × 720) für PR und Meldung.
