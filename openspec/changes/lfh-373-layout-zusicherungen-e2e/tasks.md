# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`). Bei den Fixes
steht zuerst der rote e2e-Nachweis, dann der Fix. Der rote Lauf wird mit seinem
Fehlertext protokolliert, weil ein Nachweis, der nie rot war, nichts belegt. Alle Läufe
setzen `CARGO_TARGET_DIR` auf ein eigenes Verzeichnis (geteiltes Target über Worktrees,
siehe Memory). Die Wegwerf-Spikes liegen im Scratchpad, nicht in `frontend/e2e/`, damit
kein voller `pnpm e2e`-Lauf sie mitnimmt.

## 1. Messinfrastruktur

- [x] 1.1 `e2e/cls-kern.ts`: `beobachteShifts`/`leseShifts`/`setzeShiftsZurueck`/`ruheShifts` als reinen Move aus `einsatzauswahl-cls.spec.ts` heben, dort importieren. Verifiziert dadurch, dass `einsatzauswahl-cls.spec.ts` unverändert grün ist und `git diff` in der Spec nur Import und entfernte Definitionen zeigt
- [x] 1.2 `e2e/fokus-kern.ts`: optionales drittes Argument `{ zusatzKandidaten?: string[]; region?: string }` mit Zähler `stoppsInRegion` (design.md D3). Liegt in `befehl-aktionsleiste.spec.ts` ein allgemeiner Freistreifen-Helfer, zieht er als reiner Move mit. Verifiziert dadurch, dass `fokus-verdeckung`, `befehl-aktionsleiste`, `dokumente` und `pegel-pruefliste` unverändert grün sind
- [x] 1.3 Selbstbeweis in `fokus-verdeckung.spec.ts`: absolute Attrappe über einem Knopf, ein Lauf mit `zusatzKandidaten` meldet genau einen Treffer, derselbe Lauf ohne Option meldet null. Verifiziert durch den grünen Test und eine Mutationsprobe, in der der Kern die Option ignoriert (rot)
- [x] 1.4 `gate3-trefflaeche.spec.ts`: Helfer für die kurze Achse (`min(Breite, Höhe)` je Knoten, gibt kleinstes und größtes Maß zurück) nach design.md D2. Verifiziert durch seine Nutzung in 2.3 und eine Mutationsprobe mit Messung nur der Höhe (bleibt bei 2.3 nicht grün, wenn eine Zelle schmaler ist)

## 2. Zeile 2 · Trefffläche je Stufe

- [x] 2.1 ETB-Block in `gate3-trefflaeche.spec.ts`: Einsatz und drei Einträge per API säen, je Stufe Slash-Optionen (über „Feld“, `[data-slash-menu] [role="option"]`, jede Option einschließlich der gescrollten), Zeilenauslöser (30/48/72) und Menüeinträge des ersten Auslösers (24/48/72, Portal-Selektor, eingeschwungener Kasten per `expect.poll`). Gegenprobe: kompakt < handschuh je Zielsorte. Messwerte als Annotation. Verifiziert durch den grünen Test (Vorab-Messung: 35,5/72, 30/72, 30/72) und eine Mutationsprobe mit festgenagelter Dichte (die Wache wird rot)
- [x] 2.2 Lagekarten-Block in `gate3-trefflaeche.spec.ts` bei 1366 × 768: zwei verortete UHS säen (`POST …/uhs`, `PATCH lat/lon`), zwei Stände (`POST …/lage-snapshots`), Zeitachse per localStorage ausgeklappt. Je Stufe die „Verortet“-Einträge (Höhe, Mindestzahl 2, exakte Namen statt `getByRole('button')` wegen des Klappkopfs), die fünf Kartenknöpfe (kurze Achse, 32/48/72) und die Knöpfe der Zeitachse samt „Abspielen“ (kurze Achse). Verifiziert durch den grünen Test (gemessen 35,5/48/72, 32/48/72, 30/48/72). „Abspielen“ hält bei 1366 px, das Schrumpfen auf 16 px tritt erst bei 390 px auf und wird deshalb in 6.4 rot gemessen
- [x] 2.3 Gefahrenmatrix-Block in `gate3-trefflaeche.spec.ts` bei 1366 × 768 ohne `hasTouch`: zwei Gefahrengebiete über `POST …/zonen` säen, `toHaveCount(58)` für `getByRole('button', { name: /^Bewertung / })`, kurze Achse gegen 30/48/72, Gebietszeilen gegen die Staffel. Gegenprobe: größtes Maß in `kompakt` < 48. Verifiziert durch den grünen Test (Vorab-Messung 38,75 × 30 / 72 × 72) und eine Mutationsprobe mit Messung nur in `handschuh` (die Gegenprobe fehlt, also rot)

## 3. Zeile 13 · ETB: Fokus hinter der Erfassungsleiste

- [x] 3.1 Roter Nachweis in `fokus-verdeckung.spec.ts`: 16 Einträge säen, 390 × 600 und 1366 × 520, `kompakt` und `handschuh`. Start ausdrücklich am ersten Zeilenauslöser, Vorbedingungen: Leiste `toHaveCSS('position', 'sticky')`, Bildlaufreserve > Leistenhöhe, mindestens 15 besuchte Zeilenauslöser (`data-e2e-fokus`). Zusicherung: `verdeckt` leer und Freistreifen > 0. Verifiziert durch einen roten Lauf vor dem Fix (Vorab-Messung: jeder Zweite bis jeder Auslöser vollständig verdeckt), Fehlertext im Protokoll
- [x] 3.2 Hook `useFokusabstandUnten(abstand, variable)` als geteilte Messung (design.md D4 mit Korrektur: die gemeinsame Scrollport-Regel rollte bei jedem Fokus IN der ETB-Leiste die Seite ans Ende; das ETB nutzt jetzt `scroll-margin` an den Zeitachsen-Zielen, die Befehlsseite behält ihre Regel in `befehlAktionsleiste.css`). Verifiziert durch Vitest für den Hook (Variable gesetzt, beim Aushängen entfernt, folgt einer Höhenänderung) und das unveränderte Grün von `befehl-aktionsleiste.spec.ts`
- [x] 3.3 `EtbPage` hängt den Hook an `.etb-erfassung-sticky`. Verifiziert dadurch, dass 3.1 grün wird, und durch eine Mutationsprobe mit entferntem Hook (rot)

## 4. Zeile 13 · Gefahrenmatrix: Fokus hinter der fixierten Spalte

- [x] 4.1 Roter Nachweis in `fokus-verdeckung.spec.ts`: 390 × 400 und 1024 × 768 je `kompakt`/`handschuh`, alle 58 Zellen mit `data-e2e-fokus` markiert, Start an der ersten Zelle, Schrittbudget ≥ 62. Vorbedingungen: Tabellenhülle `scrollWidth > clientWidth`, `.ant-table-sticky-holder` sticky, 58 besuchte Zellen. Verifiziert durch einen roten Lauf vor dem Fix (Vorab-Messung: vollständig hinter `td.ant-table-cell-fix`)
- [x] 4.2 `scroll-padding-inline-start` am Scrollcontainer der Matrix in der GEMESSENEN Breite der fixierten Spalte (`setzeSpaltenFreiraum`, design.md D5 mit Korrektur: die Konstante 180 war im Handschuh-Betrieb zu schmal). Verifiziert dadurch, dass 4.1 grün wird, durch Vitest auf die Messfunktion (254 px gemessen → 254 px gesetzt; ohne Spalte 0) und eine Mutationsprobe ohne die Regel (rot, 8.1)
- [x] 4.3 Rückwärtslauf (`Shift+Tab`) über die Matrix messen. **Gemessen rot** (390 × 400: Zellen vollständig unter der Kopfzeile). Fix mit der Mechanik der Katalogtabellen: `useKopfFreiraum` exportiert, `scroll-margin-top` an den Zielen in `gefahrenMatrix.css`. Verifiziert durch den Test in `fokus-verdeckung.spec.ts` und die Notiz des Ergebnisses im Nachtrag der Prüfliste

## 5. Zeile 13 · Lagekarte, Personenkarte, Personenliste

- [x] 5.1 Roter Nachweis in `fokus-verdeckung.spec.ts`: Lagekarte bei 390 × 844 (Leiste aus- und eingeblendet) und 1024 × 768 in `handschuh`, Zeitachse ausgeklappt, `pruefeFokusVerdeckung` mit `zusatzKandidaten` der Karte und `region: '[data-lfh="kartenspalte"]'`. Dazu Box-Schnitt Knopfblock gegen jedes Fußband und ein echter Klick auf jeden Kartenknopf (`toBeVisible` belegt keine Klickbarkeit). Verifiziert durch einen roten Lauf vor dem Fix (Vorab-Messung: Herauszoomen/Norden/Messen 100 % unter dem Band)
- [x] 5.2 `fussStil` wird Funktion der Knopfkante, der Fuß endet vor der Knopfspalte (design.md D6), in `KartenFuss` und jedem weiteren Fuß-Aufrufer. Verifiziert dadurch, dass 5.1 grün wird, durch Vitest auf die reine Funktion (`right` = 2 × Abstand + Kante für kompakt und handschuh) und `lagekarte-smoke.spec.ts` grün. **Zielkonflikt entschieden (25.09.2026):** die Einrückung kostet bei 1440 × 900 eine Reihe (Zeitachse 73 statt 46 px); der Smoke-Test sichert statt „einzeilig“ jetzt seinen ursprünglichen Befund (die Stand-Reihe bricht nicht in eine eigene Zeile) und „höchstens zwei Reihen“
- [x] 5.3 Personenkarte (`/personen?ansicht=karte`, LFH-613 4·13): derselbe Lauf mit den Kartenkandidaten bei 390 × 844 und 1366 × 768 in `handschuh`. Verifiziert durch den grünen Test, bei rotem Ergebnis nach dem Fix aus 5.2
- [x] 5.4 Personenliste (LFH-613 1·13): Tab-Durchlauf im Muster des KatalogTabelle-Tests auf der Personenroute mit gesäten Personen (`POST …/personen`), 390 × 400 und 1366 × 520, Bildlaufreserve als Vorbedingung. Verifiziert durch den grünen Test oder, falls rot, durch einen Fix nach dem Muster aus 4.2

## 6. Zeile 12 · Flächen und Sprünge

- [x] 6.1 `e2e/leisten-flaeche.spec.ts`, roter Deckel für das ETB: Ruhezustand herstellen, Leistenhöhe ≤ 50 % der Fensterhöhe bei 390 × 844, 1024 × 768, 1366 × 768 in allen drei Stufen. Textfeld auf dem Handschirm so breit wie die Leiste abzüglich Polsterung, `document.documentElement.scrollWidth` ≤ Fensterbreite. Verifiziert durch einen roten Lauf vor den Hebeln (Vorab-Messung: 497/844, 440/768)
- [x] 6.2 Hebel aus design.md D8 nacheinander über eine opt-in-Eigenschaft der `Schnellerfassungszeile` bzw. des `MarkdownEditor` ziehen, nach jedem 6.1 messen und aufhören, sobald es grün ist. Die Hinweiszeile wird unter `md` zur einzeiligen Kurzform mit dem Tastaturvertrag (Checkpoint 25.09.2026). Halten alle Hebel den Deckel nicht, wird zurückgefragt. Verifiziert durch 6.1 grün, das unveränderte Grün der Vitest-Suiten von `Schnellerfassung`, `MarkdownEditor` und `PersonenPage`, eine reine Stilfunktion für den Umbruch mit eigenem Vitest und `etb-chronologie.spec.ts`/`seitenrinne.spec.ts` grün
- [x] 6.3 Drei gesetzte Felder auf dem Handschirm in `handschuh` (Entscheidung 25.09.2026, design.md D8 Hebel 4–6): Seite rollt nicht, Zeitachsenzeilen stehen (± 0,5 px, nach `document.fonts.ready`), Leiste wächst ≤ 2 px, steht ab scrollY 0 ganz im Fenster, Feldzeile rollt waagerecht (Vorbedingung). Verifiziert durch den grünen Test (vorher gemessen: 578 px, Überstand bis 166 px, Fokus-Sprünge bis 2593 px) und Vitest (`chipZeileStil`, `rolleWaagerechtInsBild`, `MetaChip` fokussiert mit `preventScroll`, `EinsatzSeite.fuss`)
- [ ] 6.4 Zeitachsenband: Deckel ≤ 50 % der Kartenhöhe bei 1366 × 768, 1024 × 768, 390 × 844 (Leiste aus) in allen drei Stufen, kein Kind über den Bandrand, Band in der Kartenspalte, auch bei eingeblendeter Leiste auf dem Handschirm. Erst rot messen (nach 5.2 wird das Band schmaler), dann die Hebel aus design.md D7 der Reihe nach ziehen. Hebel 2 („Abspielen“ `flexShrink: 0`) gehört unabhängig davon dazu, und zwar samt Umbruch des Zeitleisten-Blocks. Halten alle Hebel den Deckel nicht, wird zurückgefragt. Verifiziert durch den grünen Test, 2.2 grün und die Vitest-Suite von `SnapshotLeiste`
- [ ] 6.5 CLS beim Laden auf dem Handschirm für ETB, Lagekarte und Gefahrenmatrix über `cls-kern.ts`, mit Inhaltsanker als Vorbedingung, Summe ≤ 0,1. Verifiziert durch den grünen Test. Ist eine Route rot, wird die Ursache per Geometrie belegt und im selben Change gefixt (Hypothese Matrix: Titelzeile kommt nach der Tabelle)
- [ ] 6.6 Fremdänderung einer Matrixzelle: Ruhezustand, dann `PUT …/matrix/bewertung` per `page.request`, Vorbedingung `data-warnstufe="akut"` an der Zelle, danach Tabellenlage unverändert und Summe ≤ 0,1. Verifiziert durch den grünen Test

## 7. Prüflisten, Verweise, Doku

- [ ] 7.1 Nachtrag „LFH-373 (Messung)“ in `2026-07-30-etb-pruefliste.md`, `…-lagekarte-karten-pruefliste.md` und `…-gefahrenmatrix-pruefliste.md` mit Verdikt je Zeile (1, 2, 12, 13), Messgröße und Spec-Datei, einschließlich der Korrekturen „Verortet ist fokussierbar“ und „Gebietszeile ist fokussierbar“. Verifiziert durch Lesen gegen die Testnamen: jedes „erfüllt“ nennt einen existierenden Test
- [ ] 7.2 `2026-08-21-lfh-342-pruefliste.md`: Zeile 12 von „erfüllt“ korrigieren (Stütze `Datensicht`/`EtbTabelle.test.tsx` gibt es nicht mehr), Zeile 13 auflösen. `2026-09-22-lfh-613-pruefliste.md`: 1·13 und 4·13 mit Verdikt. Verifiziert durch `grep -n "LFH-373"` in beiden Dateien: nur noch Verdikte, keine offenen Verweise
- [ ] 7.3 Die Verweise auf die Stufenableitung in den Prüflisten von LFH-342, -343, -345, -346, -347 und -348 auf LFH-724 umschreiben. Verifiziert durch `grep -rn "LFH-373" docs frontend openspec CLAUDE.md`: jeder Rest ist ein Verdikt dieses Tickets oder historischer Text mit Verweis auf den Nachtrag
- [ ] 7.4 CLAUDE.md: den Satz „Nicht bei 390 px … Sidebar fest 300 px“ im LFH-355-Absatz durch den gemessenen Stand ersetzen, eine knappe Zeile zu `--lfh-fokusabstand-unten` (gemeinsame Regel statt seitenlokalem `:root`), eine Zeile zur Knopfspalte des Kartenfußes. Verifiziert durch Lesen und `check-fmt.sh` (Prettier)

## 8. Abschluss

- [ ] 8.1 Mutationsproben nach design.md D11 in einem gemeinsamen Lauf, Ergebnis im Kopfkommentar der jeweiligen Spec. Verifiziert durch das JSON-Protokoll: jede tragende Mutation ist rot, das Original grün, die Kopien sind gelöscht
- [ ] 8.2 `lint`, `tsc`, Vitest voll, Prettier. Verifiziert durch grüne Läufe ohne `| tail`
- [ ] 8.3 `scripts/check-all.sh` mit eigenem `CARGO_TARGET_DIR` per `nohup`. Verifiziert durch Exit 0, bei Flakes durch Wiederholung des einzelnen Specs mit Begründung
- [ ] 8.4 Review (`superpowers:requesting-code-review`) und PR gegen `alpha`
