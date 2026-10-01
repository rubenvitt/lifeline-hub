# Tasks

## 1. Wächter der Textstufen (zuerst rot)

- [ ] 1.1 `frontend/src/theme/textstufen.test.ts` anlegen: für `farbenHell` und `farbenDunkel` jede Textstufe (`text`, `text2`, `gedaempft`, `schwach`) gegen jede deckende Fläche (Literal-Liste: `grund`, `flaeche`, `flaeche2`, `flaeche3`, `paneel`, `kopf`, die vier Statusflächen, `bannerGrund`, drei Zeilentönungen) mit Tag ≥ 7, Nacht ≥ 5; ΔL\* ≥ 5 zwischen benachbarten Stufen; Reihenfolge des Kontrasts auf `grund`. Kontrast- und L\*-Rechnung aus `rahmenKontrast.test.ts`/`statusFarben.test.ts` in eine gemeinsame Testhilfe ziehen statt kopieren. Prüfen: Der Lauf (`mise exec -- pnpm -C frontend vitest run src/theme`) wird **rot**, genau an Tag `schwach`/`gedaempft` und Nacht `schwach`.
- [ ] 1.2 Mutationsprobe festhalten: `schwach` (Tag) testweise auf `#3c434c` setzen (ΔL\* zu `gedaempft` < 5) → der ΔL\*-Fall wird rot; zurücksetzen. Ergebnis im Commit-Text notieren.

## 2. Werte anheben

- [ ] 2.1 `tokens.ts`: `farbenHell.gedaempft` → `#363d45`, `farbenHell.schwach` → `#424a53`, `farbenDunkel.schwach` → `#838b94`; `rollen.css` deckungsgleich (`--lfh-gedaempft`, `--lfh-schwach` beider Modi, `--lfh-etb-system-kante`/`-wort` beider Modi, `--lfh-rahmen-gesperrt`). Prüfen: `textstufen.test.ts`, `rollen.guard.test.ts`, `rahmenKontrast.test.ts` und `statusFarben.test.ts` grün.
- [ ] 2.2 Kommentare am Wert nachziehen: Kopf von `farbenHell` (Boden, neue Messwerte, ΔL\*-Regel, Verweis auf diese Change), Abweichungsblock von `farbenDunkel` (`schwach` ≥ 5,11), `colorTextPlaceholder` (≥ 7 Tag / ≥ 5 Nacht), `rahmenFarben` (`gesperrt` 5,60 auf `grund`). Prüfen: `rg -n "5,33|4,72|5,17|≥ 5 : 1" frontend/src/theme` findet keinen veralteten Messwert mehr.

## 3. Browser-Gates ohne Tertiär-Ausnahme

- [ ] 3.1 `e2e/abloesung-kontrast.spec.ts`, `e2e/verpflegung-kontrast.spec.ts`, `e2e/betreuung-pruefliste.spec.ts`: `TERTIAER`, das Feld `tertiaer` und den Ausnahmezweig „Tertiärtext → LFH-643“ entfernen, Kopfkommentar auf eine Ausnahme (LFH-661) kürzen. Prüfen: `rg -n "LFH-643|TERTIAER" frontend/e2e` findet nichts mehr; die drei Specs laufen grün gegen den vollen Boden.
- [ ] 3.2 `e2e/betroffene-kontrast.spec.ts`: die zwei Messungen „(LFH-643)“ (Hinweis „vermisst seit“, Leerzustand-Hinweis) gegen `minimum` statt 4,5, Kommentare anpassen. Prüfen: Spec grün in beiden Modi.
- [ ] 3.3 `e2e/hellmodus-kontrast.spec.ts`: neuer Fall je Modus, der eine Augenbraue auf `grund`, `paneel` und `flaeche` misst (Messkern `kontrast-kern.ts`) und den gemessenen Grund gegen die Rolle zusichert. Prüfen: grün mit den neuen Werten; mit `farbenHell.schwach` testweise auf `#58606a` rot (Mutationsprobe, im Commit-Text notiert).

## 4. Regel dokumentieren

- [ ] 4.1 `frontend/AGENTS.md`, Farbachsen/Tagmodus: Boden für alle Textstufen (Tag 7, Nacht 5, Ausnahme nur Gesperrtes), ΔL\*-Regel, Wächter `theme/textstufen.test.ts`, Verweis auf die archivierte Change. Prüfen: `mise exec -- pnpm -C frontend prettier --check AGENTS.md` grün.

## 5. Integration

- [ ] 5.1 `./scripts/check-all.sh` grün (Bündel inkl. Lint, Typecheck, Vitest, Prettier); die e2e-Kontrast-Specs (`abloesung`, `verpflegung`, `betreuung-pruefliste`, `betroffene`, `hellmodus`) einzeln grün. Messwerte der Augenbraue in den PR-Text.
- [ ] 5.2 Sichtprüfung im Tagbetrieb (Überblick, Ablösung mit überfälliger Karte, ein Filter mit Platzhalter, ein Dialog mit Feldhilfe): Rangfolge `gedaempft` → `schwach` sichtbar; Bildschirmfoto in den PR.
