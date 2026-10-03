# Tasks

## 1. Mechanik in `components/Liste.tsx` (LFH-826)

- [x] 1.1 Tests zuerst in `Liste.test.tsx`: Kopf `unterEbene` 2 → Eintragstitel `heading` Ebene 4; Kopf `unterEbene` 5 → Ebene 6 (Deckel); ohne Kopf mit `unterEbene` 2 → Ebene 3; ohne beides → kein `heading`, Titeltext sichtbar; Kopf ohne Inhalt → kein `heading`; Schriftgewicht von `div`- und `h*`-Titel gleich (`token.fontWeightStrong`). Verifikation: die neuen Fälle laufen rot (`mise exec -- pnpm -C frontend exec vitest run src/components/Liste.test.tsx`).
- [x] 1.2 `ListeContext` um `titelEbene` erweitern, `Liste`-Props als Union `kopf` XOR `unterEbene`, Berechnung nach design.md D1; `ListenEintragMeta` rendert `h{N}` oder `div` mit identischem Inline-Stil inkl. `fontWeight`. Verifikation: 1.1 grün, `tsc` meldet einen Fehler, wenn `kopf` und `unterEbene` zusammen gesetzt werden (Typtest mit `@ts-expect-error` in `Liste.test.tsx`).
- [x] 1.3 Dateikopf von `Liste.tsx` um den Absatz „Eintragstitel (LFH-826)“ ergänzen und den veralteten Kommentar „Titel als <h4>“ in `ListenEintragMeta` ersetzen. Verifikation: `grep -n "h4" frontend/src/components/Liste.tsx` zeigt nur noch `KOPF_ELEMENT`.

## 2. Einbauorte mit Überschrift `h3`

- [x] 2.1 `pages/StabPage.tsx` (Besetzung S1–S6): `unterEbene={2}`; `pages/StabPage.test.tsx` von `level: 4` auf `level: 3` umstellen. Verifikation: Test grün, vorher mit unveränderter Seite rot.
- [x] 2.2 `stab/LagebesprechungHistorie.tsx`: beide `Liste`-Instanzen (sichtbar und im Collapse „Frühere“) `unterEbene={2}`; `LagebesprechungHistorie.test.tsx` auf `level: 3`. Verifikation: Test grün.
- [x] 2.3 `pages/PressePage.tsx` (Pressemitteilungen): `unterEbene={2}`; Test in der passenden `PressePage`-Testdatei, dass ein Mitteilungstitel `heading` Ebene 3 ist. Verifikation: neuer Test erst rot, dann grün.

## 3. Einbauorte ohne Überschrift (begründeter Verzicht)

- [x] 3.1 `chat/NachrichtenStrom.tsx`, `stammdaten/FuehrungsfunktionenTab.tsx`, `pages/einstellungen/EinsatzPegel.tsx`, `karten/OfflineRegionPicker.tsx`, `karten/OfflineVorhandeneModal.tsx`, `karten/AusKatalogModal.tsx`: keine `unterEbene`, je ein Ein-Satz-Kommentar mit Grund nach design.md D2. Verifikation: in `NachrichtenStrom.test.tsx` ein Test „Nachrichten sind keine Überschriften“ (`queryAllByRole('heading')` im Strom leer, Autorname sichtbar); die übrigen Orte deckt der Liste-Test „ohne beides kein heading“ ab.
- [x] 3.2 Tests und e2e-Specs, die an diesen Orten Zeilentitel per Rolle `heading` suchen, finden und auf Text- bzw. Listenpunkt-Abfragen umstellen (`grep -rn "heading" frontend/src frontend/e2e` gegen die sechs Dateien und ihre Seiten). Verifikation: betroffene Vitest-Dateien grün; geänderte e2e-Specs mit `--list` lauffähig und, wo der Stack läuft, grün.

## 4. Regel und Abschluss

- [x] 4.1 `frontend/AGENTS.md`, Komponentenkatalog neben `Markdown`: Regel nach design.md D3. Verifikation: `mise exec -- pnpm -C frontend exec prettier --check AGENTS.md` grün.
- [ ] 4.2 Gesamtlauf `./scripts/check-all.sh` (bzw. die Bündel, die in der Cloud-Sitzung laufen: Frontend-Lint, Typecheck, Vitest, Prettier) grün; Kästchen, die erst die CI des PRs belegt, mit Verweis auf diesen Lauf abhaken.
