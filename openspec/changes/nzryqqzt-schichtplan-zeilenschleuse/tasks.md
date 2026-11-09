## 1. Ableitung der Zeilen (D2)

- [x] 1.1 Tests in `abloesung/schichtplan/zeilenSchleuse.test.ts` (rot) für `schleuseZeilen`: ohne Änderung gleich; neuer Posten vorn → wartet, `neu` 1, keine Umsortierung; entfallener Posten → Zeile aus dem Gerippe mit `entfallen`, `entfallen` 1; umgekehrte Folge → gezeigte Folge, `umsortiert`; Gruppenwechsel → eingefrorene Gruppe, `umsortiert`; frischer Titel bei gleichem Schlüssel.
- [x] 1.2 Tests für `schleusenText`: Einzahl und Mehrzahl, Verbindung „ · “, ohne Wartendes `null`; dazu `schleusenKurz` für die Kurzform des Banners auf dem Handschirm („2 neu“, „1 entfallen“, „umgeordnet“).
- [x] 1.3 `zeilenSchleuse.ts` umsetzen.

## 2. Raster und Liste (D3, D4)

- [x] 2.1 `raster.test.ts` (rot): `pruefeZug` antwortet für eine Zeile mit `entfallen` `keine-zeile`. `RasterZeile.entfallen` in `raster.ts`, `pruefeZug` anpassen.
- [x] 2.2 `SchichtplanRaster.tsx`: entfallene Zeile gedämpft mit „(entfallen)“, kein Aufziehen in ihr; Rückruf `onZug(laeuft)` schon beim Druck und beim Ende eines Zugs. Test in einer neuen oder vorhandenen Raster-Testdatei, soweit jsdom es trägt (Titel, kein `pointerdown`-Anlegen).
- [x] 2.3 `SchichtplanListe.tsx`: entfallene Zeile gedämpft mit „(entfallen)“ und „—“.

## 3. Hülle mit Banner (D1, D5)

- [x] 3.1 Tests in `abloesung/schichtplan/SchichtplanSchleuse.test.tsx` (rot): ohne Fokus und Zeiger fließen neue Zeilen direkt; mit Fokus warten sie, Banner „1 neuer Posten“; „anzeigen“ zeigt sie und setzt den Fokus auf die Hülle; `halten` hält auch ohne Fokus; entfallene Zeile bleibt mit Banner „1 Posten entfallen“.
- [x] 3.2 `SchichtplanSchleuse.tsx` umsetzen (`useZuflussSteuerung`/`useZuflussSchleuse`, `mitGerippe`, Sammelbanner mit Nullhöhe).

## 4. Einbau (D3, D5)

- [x] 4.1 `SchichtplanAnsicht.tsx`: Raster und Liste in die Hülle; `halten` aus laufendem Zug, gezogener Person und offenem Dialog.
- [x] 4.2 `planung/PlanungSchichtplan.tsx`: dasselbe.
- [x] 4.3 Vorhandene Tests von Ansicht und Planung grün halten.

## 5. e2e

- [ ] 5.1 `e2e/planung.spec.ts`: Planung über die API säen (eigener Seed, zwei Posten mit Blöcken), Zeiger über einen Block der letzten Postenzeile, über die API einen Posten anlegen und per `PUT …/posten/reihenfolge` an die erste Stelle setzen → Block steht unverändert, Banner „1 neuer Posten“; „anzeigen“ → neuer Posten ist die erste Zeile.
- [ ] 5.2 `e2e/abloesung-schichtplan.spec.ts`: Zeiger über einem Block, über die API eine Einheit anlegen, die vor dem Block einsortiert wird → Block steht unverändert, Banner; „anzeigen“ → Einheit steht in ihrer Zeile.

## 6. Regeln und Doku

- [x] 6.1 `frontend/src/kraefte/AGENTS.md`, Absatz Schichtplan: Zeilenschleuse über `SchichtplanSchleuse` (eine Hülle für Einsatz und Vorplanung), Blöcke fließen direkt, entfallene Zeile, Bedingungen.
- [x] 6.2 Anwenderdoku: `docs/anwender/kapitel/abloesung.md` („Den Schichtplan führen“) und `vorplanung.md` je ein Absatz zum Banner; `quellen:` um die neuen Dateien ergänzen; Wächter der Anwenderdoku grün.

## 7. Abschluss

- [ ] 7.1 `./scripts/check-all.sh` grün (Lint, Prettier, Vitest, e2e der berührten Specs).
- [ ] 7.2 Review (`requesting-code-review`), Bilder der Änderung (Banner über dem Raster, entfallene Zeile) für PR und Meldung.
- [ ] 7.3 `/opsx:archive`.
