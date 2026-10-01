# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der Test, er wird rot, dann
die Zeile. Als belegt gilt eine Aufgabe erst, wenn ihre Mutationsprobe aus `design.md` (E3) den
Test rot macht.

## 1. Messung im eingeschwungenen Zustand (E1, LFH-702)

- [x] 1.1 Ausgangslage festhalten: `mise exec -- pnpm -C frontend exec playwright test e2e/betroffene-kontrast.spec.ts -g "light: Betroffenenliste" --repeat-each 3` auf dem unveränderten Stand. Verifikation: Das Ergebnis (Anzahl rot/grün, Messwert „Zustand-Knopf leer+hover“) steht als Notiz für den PR-Text bereit. Ist es zufällig 3/3 grün, wird mit `--repeat-each 10` wiederholt, bis die Zeitabhängigkeit belegt ist. **Befund beim Umsetzen:** 3/3 und 10/10 grün. Seit LFH-652 (`8cf9b31`) trägt ein Link-Knopf unter dem Zeiger die eigene Fläche `bedienFlaeche` (`Button.linkHoverBg`), der Zustand-Knopf misst darauf 7,11 statt 6,59 auf `flaeche3`. Der Ticket-Befund stammt von einem Stand davor. Die Zeitabhängigkeit wird deshalb an Titel-Anker und „—“ der Dokumentenablage belegt (3.1), die auf der reinen Zeilenfläche stehen.
- [x] 1.2 `frontend/e2e/kontrast-kern.ts`: Schritt `eingeschwungen(ziel)` (Stilberechnung anstoßen, endliche Animationen an Element und Vorfahren über `document.getAnimations()` abwarten, Obergrenze mit sprechendem Fehler). `pruefe()` ruft ihn vor jedem Messversuch auf. Kommentar im Dateikopf nennt LFH-702 und die Regel. Verifikation: Mit den alten Werten von `bedienText`/`gedaempft` ist `e2e/dokumente.spec.ts -g "Kontrast light" --repeat-each 3` in 3 von 3 Läufen rot. Der Fehlertext nennt `flaeche3` (225,228,232) als Grund (6,59). Belegt am 01.10.2026.
- [x] 1.3 Mutationsprobe (a): Den Aufruf von `eingeschwungen` vorübergehend entfernen und den Lauf aus 1.2 (alte Werte, `--repeat-each 5`) wiederholen. Verifikation: Das Ergebnis ist zeitabhängig (gemessen: 4 grün, 1 rot) und steht im PR-Text. Danach wird der Aufruf zurückgesetzt.

## 2. Textrollen am Tag abdunkeln (E2, LFH-877)

- [x] 2.1 `frontend/src/theme/bedienKontrast.test.ts`: neues `describe` „Textrollen auf jeder Flächenstufe (LFH-702/LFH-877)“, das `bedienText` und `gedaempft` gegen `grund`, `flaeche`, `flaeche2`, `kopf`, `paneel` und `flaeche3` rechnet. Böden als Literale: Tag 7, Nacht 5. Verifikation: Vor 2.2 rot (Tag, `flaeche3`: 6,59/6,60), die Nacht ist grün.
- [x] 2.2 `frontend/src/theme/tokens.ts`: `farbenHell.bedienText` = `#144779`, `farbenHell.gedaempft` = `#40464e`. `frontend/src/theme/rollen.css` spiegelt den Tagblock (`--lfh-bedien-text`, `--lfh-gedaempft`). `--lfh-etb-system-wort` zieht mit, weil `etbTypFarbenHell.system.wort` auf `gedaempft` zeigt. Verifikation: 2.1 grün, `rollen.guard.test.ts` und `gate5.guard.test.ts` grün.
- [x] 2.3 Kontrast-Kommentare an `farbenHell` in `tokens.ts` nachziehen: Kopfblock (`bedienText`/`bedienFlaeche`), Absatz „Geerbter Text“ mit den Werten aus `design.md` und der Satz „unter dem Tagesboden (LFH-877)“, der durch die neuen Werte auf `flaeche3` ersetzt wird. Kommentare in `KatalogTabelle.tsx` (`tabellenTokens`, Kopftext 7,37) prüfen. Verifikation: `grep -rn "6,59\|6,60\|LFH-877" frontend/src` zeigt keinen veralteten Wert mehr für `bedienText`/`gedaempft`.
- [x] 2.4 `frontend/src/personen/personBearbeiten.test.ts`: Das Literal `#164f86` wird `farbenHell.bedienText`. Verifikation: Der Test ist grün, `grep -rn "164f86" frontend/src` ist leer.
- [x] 2.5 Mutationsproben (b) und (c) aus `design.md`: Je einen Wert zurückdrehen und den Einheitstest ausführen. Verifikation: Jede Rücknahme macht 2.1 rot. Ergebnis steht im PR-Text.

## 3. Browsernachweis auf der Hervorhebungsfläche (Spec „Böden für geerbten Text“)

- [x] 3.1 `frontend/e2e/dokumente.spec.ts`, Test „Kontrast …“: Nach dem Block „geerbt“ den Zeiger über die Dokumentzeile legen (`zeile.hover()`, Vorbedingung `td.ant-table-cell-row-hover`) und Titel-Anker sowie „—“ gegen `KONTRAST_ZIEL[modus]` messen. Die Messwerte kommen in den Anhang. Verifikation: In beiden Modi grün. Mit `bedienText` oder `gedaempft` auf dem alten Wert ist der Tag-Lauf rot.
- [x] 3.2 `frontend/e2e/betroffene-kontrast.spec.ts` (light und dark, LFH-650) mit `--repeat-each 3`. Verifikation: 3 von 3 grün. Messwert „Zustand-Knopf leer+hover“ am Tag gegen `bedienFlaeche` (Knopffläche unter dem Zeiger), nicht gegen `flaeche3`.
- [ ] 3.3 Alle Nutzer des Messkerns (`grep -l kontrast-kern e2e/`; `karten-pixel-kern.ts` nennt ihn nur im Kommentar) mit dem neuen Messkern, je `--repeat-each 3`. Zuerst gelaufen (vor dem Review-Befund, nur `pruefe` schwang ein): `abloesung`, `betroffene`, `fachebenen`, `hellmodus`, `kraefte`, `primaerknopf`, `verpflegung`-Kontrast und `dokumente` -g Kontrast, 99 + 6 grün. Nach der Verlegung in `messe()` (Review): alle Nutzer erneut. Verifikation: alle grün. Wird eine Stelle rot, die nicht über `bedienText`/`gedaempft` läuft, ist das ein Blocker für den Menschen und keine Ausnahme im Spec (`design.md`, Risiken).

## 4. Regeln und Prüfspur

- [x] 4.1 `frontend/AGENTS.md`, Farbachsen: Im Abschnitt „Geerbter Text“ bzw. „Tagmodus“ ergänzen, dass Text auf der Hervorhebungsfläche (`flaeche3`, Hover- und Aktivzeile) den vollen Boden hält. Verweis auf diese Change. Verifikation: Prettier über `frontend/` ist grün, und die Regel steht genau einmal.
- [x] 4.2 `frontend/e2e/AGENTS.md`: Regel „Kontrast misst eingeschwungen“, also `pruefe()` wartet Übergänge ab und Hover-Messungen brauchen keine eigene Wartezeit. Verweis auf `kontrast-kern.ts`. Verifikation: Prettier grün, keine Doppelung in `frontend/AGENTS.md`.
- [x] 4.3 `docs/superpowers/specs/2026-09-22-lfh-632-pruefliste.md`: In Zeile 5 und in der Restzeile „Hover-Zeile `flaeche3` … (LFH-877)“ einen Nachtrag mit den gemessenen Werten aus 3.1 anfügen, wie es LFH-652 vorgemacht hat. Verifikation: Die Werte stimmen mit dem Anhang des Laufs überein.
- [x] 4.4 ClickUp: Kommentar an LFH-643, dass `schwach` auf `flaeche3` (4,99) dort offen bleibt und `bedienText`/`gedaempft` hier gelöst sind. Verifikation: Der Kommentar ist angelegt.

## 5. Abschluss

- [ ] 5.1 `./scripts/check-all.sh` grün (lokal, soweit die Umgebung es trägt, sonst die CI des PRs). Verifikation: Ausgabe ohne roten Schritt.
- [ ] 5.2 Review (`superpowers:requesting-code-review`), Befunde abgearbeitet. Verifikation: Es gibt keine offenen bestätigten Befunde.
