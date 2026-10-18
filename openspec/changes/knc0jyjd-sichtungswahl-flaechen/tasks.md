# Tasks

Subtask LLH-1083 (`knc0jyjd`) von LLH-1018. Jede Aufgabe entsteht per TDD
(`superpowers:test-driven-development`). Geprüft wird mit
`mise exec -- pnpm -C frontend exec vitest run <Datei>` bzw. mit der genannten e2e-Spec.

## 1. Palette und Kontrast

- [ ] 1.1 `sichtungsflaechen` (Fläche und Schrift je Kategorie) in `theme/tokens.ts` mit Kommentar zur Rolle; ein neuer `theme/sichtungKontrast.test.ts` rechnet Text gegen Fläche (≥ 7 : 1, gilt in beiden Modi) und Kante (`text` des Modus) gegen `grund` und `flaeche` (≥ 3 : 1) in Tag und Nacht. Mutationsprobe: Mit `#f5222d` wird der Test rot.
- [ ] 1.2 `SK_REIHE` aus `AufnahmeFelder.tsx` nach `personen/personMeta.ts` verschieben und exportieren; vorhandene Tests grün.

## 2. Baustein SichtungsWahl

- [ ] 2.1 `personen/SichtungsWahl.tsx` mit `value`/`onChange`/`abwaehlbar`/`disabled`: Flächen mit Kürzel und Wort, Randform der übrigen nach einer Wahl, ✓ und Rahmen. Vitest `SichtungsWahl.test.tsx`: Reihenfolge, Farben aus `sichtungsflaechen`, `unverletzt` ohne Farbe, `aria-checked`, Name der Gruppe.
- [ ] 2.2 Tastatur (Roving-Tabindex, Pfeile, Leertaste/Enter wählen, Enter sendet kein Formular ab) und Abwahl nur bei `abwaehlbar`; Vitest.
- [ ] 2.3 Maße: Höhe `max(72, controlHeight)`, Breite ≥ 96, Lücke 8/16 je Dichte; Vitest über zwei Dichtestufen (Muster des bisherigen `skFlaechenStil`-Tests).

## 3. Einbau

- [ ] 3.1 `AufnahmeFelder`: `Radio.Group` durch `SichtungsWahl abwaehlbar` ersetzen, `skFlaechenStil` entfernen; `AufnahmeFelder.test.tsx`, `PersonErfassungModal*.test.tsx` und `BestaetigtVonFeld.test.tsx` nachziehen (Abwahl → Anlegen ohne Sichtung).
- [ ] 3.2 `SichtungDialog`: `Select` durch `SichtungsWahl` ersetzen; ein Vitest belegt, dass `radiogroup` vorhanden ist und kein `combobox` für die Kategorie, und dass Fläche plus „Übernehmen“ `erfasseSichtung` aufruft.
- [ ] 3.3 Geräteweg (UHS-Tablet: Aufnahme und Nachsichtung) im bestehenden Vitest bzw. in `e2e/geraet-uhs-tablet.spec.ts` grün.

## 4. Nachweise im Browser

- [ ] 4.1 `e2e/betroffene-kontrast.spec.ts` misst die Flächen (Text und Kante) in Tag und Nacht.
- [ ] 4.2 `e2e/trefflaeche-pruefflaechen.spec.ts` misst die Flächen (≥ 72 × 96, Abstand) in `kompakt` und `handschuh`.

## 5. Regeln und Doku

- [ ] 5.1 `frontend/AGENTS.md`, „Farbachsen → Sichtung“: Wahl als Vollfläche über `SichtungsWahl` (Flächenpalette, Kante in `text`), Anzeige als umrandetes Farbfeld. `frontend/src/personen/AGENTS.md` (Erfassung und Nachsichtung). Prettier grün.
- [ ] 5.2 Kapitel `docs/anwender/kapitel/betroffene.md` und `geraet-uhs.md` beschreiben die Wahl. Bilder `betroffene/erfassen.png`, `geraet-uhs/aufnahme.png` und `geraet-uhs/sichtung.png` sind neu erzeugt (Mitänderungsregel `docs/anwender/AGENTS.md`), der Wächter der Anwenderdoku ist grün.
