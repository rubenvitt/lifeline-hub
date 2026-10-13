# Tasks

Arbeitsweise je Aufgabe: `superpowers:test-driven-development` (erst der rote Test, dann der
Code). Frontend-Gates aus `frontend/` über `mise exec -- pnpm …` (ohne mise: `pnpm` aus
`/opt/node22`). Vor dem Abschluss `superpowers:verification-before-completion` und
`superpowers:requesting-code-review`.

## 1. Werkzeuge: Tabelle und Sperrlogik (D2)

- [x] 1.1 `stab/unterseiten.ts`: Einträge `fernmeldeskizze` (`funkplanPfad(id, { ansicht: 'skizze' })`) und `sprechgruppen` (`ansicht: 'sprechgruppen'`) im Modul `fernmeldewesen`, Reihenfolge Funkplan, Fernmeldeskizze, Sprechgruppen, Kommunikationsplan; `sprungmarken.test.ts` und `schnellaktionen.guard.test.ts` grün (Stab-Marken filtern auf `modul === 'stab'`, keine neue Marke)
- [x] 1.2 `stab/sachgebiete.ts`: `werkzeuge` als Liste von Werkzeug-Einträgen (`{ art: 'modul', key }` | `{ art: 'seite', key }`), Zuordnung laut design.md D2 (S1 mit Nachforderungen, S5 Presse/Infotelefon, S6 die vier Fernmelde-Einstiege), Dateikopf ohne Drei-Werkzeuge-Grenze; `sachgebiete.test.ts`: Test „höchstens drei“ entfernt, neu „S1 und S4 führen Nachforderungen“, „S6 führt die vier Fernmelde-Einstiege in dieser Reihenfolge“, „jeder Modul-Key existiert in der Registry, jeder Seiten-Key in `unterseiten.ts`“
- [x] 1.3 `stab/werkzeuge.ts`: `werkzeugZustand(eintrag, freigaben)` → `fehlt` | `gesperrt` | `frei` samt Ziel (Label, Pfad, Modul-Key) für beide Arten; ohne Freigaben `fehlt`; `werkzeuge.test.ts` deckt ab: ausgeblendet fehlt, gesperrt bleibt gesperrt, unbekannter Key fehlt, Unterseite erbt `stab`/`fernmeldewesen`, Modul im Status ≠ fertig fehlt

## 2. Zahlen (D4, D5)

- [x] 2.1 `stab/luecken.ts`: `lueckenAnzahl(luecken, netzLuecken)` laut D5 (Summe der sechs Listen-Lücken, Leitstelle mit 1, Gegenstelle nicht, ohne Anzahl bei jedem Zustand ≠ `daten`, Zustand = schlechtester); Tests in `luecken.test.ts`: Summe mit Doppelzählung einer Einheit, null Lücken = 0, Leitstelle zählt 1, eine gesperrte Quelle → `gesperrt` ohne Anzahl, eine ladende → `laden`
- [x] 2.2 `pages/FunkplanPage.tsx`: Paneel „Lücken“ mit `meta` „n Lücke(n)“ aus `lueckenAnzahl`, ohne Meta solange eine Quelle fehlt; Vitest der Funkplan-Seite um Meta „3 Lücken“ und „kein Meta bei gesperrten Einheiten“ ergänzt, bestehende Funkplan-Tests grün
- [x] 2.3 `stab/useFunkplanLuecken.ts`: `useNetzQuellen` + `baueFernmeldenetz` + `lueckenAnzahl`, fragt nur bei sichtbarem und freiem Fernmeldewesen ab; Test mit gemocktem Abruf: gleiche Quellen ergeben dieselbe Zahl wie die Funkplan-Seite (geteilte Fixture), gesperrt → keine Abfrage
- [x] 2.4 `stab/werkzeugZahlen.ts`: `werkzeugZahl(eintrag, quellen)` laut D4 (Modul über `bildeZaehler`-Karte, Aufträge mit `auftragsStand` → Ton `achtung` + Notiz „n überfällig“, Presse `offene_anfragen`, Funkplan aus 2.3, sonst `null`); Tests: Modul ohne Zähler → `null`, Feld fehlt → „—“ „nicht freigegeben“, Zähler lädt → `laden`, gescheitert ohne Stand → `fehler`, 0 bleibt 0, Nachforderungen → `null`

## 3. Bausteine der Kachel (D1, D3, D7)

- [x] 3.1 `stab/WerkzeugZelle.tsx` mit reiner Stilfunktion `werkzeugZelleStil(token, ton)`: Link mit Name, Zahl rechts (Mono 500, Stufe 22), Notiz; gesperrt als `Button disabled` mit sichtbarem `sprungGesperrtText`; ohne Zahl gleiche Zellform; Tests: Mindesthöhe ≥ `controlHeight` in 30/48/72, zugänglicher Name „Aufträge, 2, 1 überfällig“, gesperrt ohne Zahl und ohne Link, Ton `achtung` setzt Kante und Wort
- [x] 3.2 `stab/SachgebietKachel.tsx`: `Paneel` (`h2`, Titel „S4 · Versorgung“), `meta` Besetzungschip erst mit Daten, `aktion` „Besetzung ändern – S4 Versorgung“ nur mit Schreibrecht, Aufgabenzeile gekürzt mit nie gekürzter Fundstelle (D7), Werkzeugraster `role="group"` „Werkzeuge S4“ im Fugenraster; Tests: ohne Daten kein Chip und keine Aktion, Beobachter ohne Aktion, ausgeblendetes Werkzeug fehlt, Fundstelle im Text
- [x] 3.3 `stab/stabRaster.ts:stabRasterStil(spalten)` und Spaltenwahl aus `useViewport` (1 / 2 ab `md` / 3 ab `xl`); Test der reinen Funktion je Breite

## 4. Seite und Checkliste (D1, D6)

- [x] 4.1 `pages/StabPage.tsx` neu: Termin-Zeile, Raster aus sechs `SachgebietKachel`, `EinsatzSeite meta` „n/6 besetzt“ erst mit Daten, Fehler mit Wiederholen statt Raster ohne Stand, `SeitenStandVeraltet` mit Stand, `BesetzungModal` wie bisher, Zahlenquellen (`useModulZaehler`, Presse-Kennzahlen, `useFunkplanLuecken`) einmal je Seite; Dateikopf neu; `StabPage.test.tsx` umgestellt (sechs Paneele `S1 · …`, Gruppen `Werkzeuge S1`–`S6`, Reihenfolge der Regionen S1…S6, „Arbeitsaufnahme“) und um die Fälle aus design.md D8 ergänzt, grün
- [x] 4.2 `stab/ChecklistePaneel.tsx`: Einklappen laut D6 (Startwert einmal mit den ersten Daten, Knopf „Aufklappen“/„Einklappen“ im Kopf mit `aria-expanded`/`aria-controls`, Rücknahme klappt auf, letzter Haken klappt nicht ein); `ChecklistePaneel.test.tsx` um die drei Szenarien der Spec `stab-checkliste` ergänzt, grün
- [x] 4.3 Live-Nachweis in Vitest: Invalidierung von `modulZaehler` bzw. `medienkontaktKennzahlen` aktualisiert die Zahl an „Aufträge“ bzw. „Pressearbeit“ ohne Neumontage

## 5. Regeln und Doku

- [x] 5.1 `frontend/src/stab/AGENTS.md`: neuer Abschnitt „Stab-Seite“ (Kachel = Paneel, Werkzeuge aus `sachgebiete.ts` ohne Grenze, eine Sperrlogik über `werkzeugZustand`, Zahl nur über `werkzeugZahlen.ts` aus einer Heimat, Lückenzahl nur über `lueckenAnzahl`), Abschnitt „Checkliste Arbeitsaufnahme“ um das Einklappen ergänzt; `pnpm format:check` grün
- [x] 5.2 `docs/anwender/kapitel/stab.md`: „Die Zeilen der Besetzung“ → „Die Kacheln“ mit vollem Aufgabentext je Sachgebiet, Zahlen je Werkzeug und Sperre, Abschnitt Checkliste um Einklappen; `quellen:` um neue Dateien ergänzt; `docs/anwender/kapitel/funkplan.md` um die Zahl im Kopf der Lücken; `src/hilfe/anwenderdoku.guard.test.ts` grün
- [x] 5.3 Bildlauf `e2e/doku-bilder/stab.bilder.ts`: neues Bild `uebersicht.png` (Seite mit Daten), Selektoren auf die Kacheln umgestellt; `mise exec -- pnpm doku:bilder --grep stab` erzeugt hell und dunkel, Bilder ≤ 300 KB committet, Kapitel bindet `uebersicht.png` ein
- [x] 5.4 Zunder: Kommentar an LLH-722 (Feldbefund: Gestaltung, kein Ausbau) und Nachzug „Lagemeldungen mit Status und Zähler“ (angelegt als LLH-1206)

## 6. e2e und Prüfliste

- [ ] 6.1 `e2e/gate3-trefflaeche.spec.ts` (Stab): Konstanten auf 19 Werkzeuge, 6 Gruppen, 6 Knöpfe; Anker Gruppen `Werkzeuge S\d` statt Region „Besetzung S1–S6“; Beobachter-Test mit 0 Knöpfen; grün in `kompakt`, `komfortabel`, `handschuh`
- [ ] 6.2 `e2e/stab-schmal.spec.ts` neu: 390 × 844, Kacheln untereinander, keine Kachel schmaler als 90 % der Inhaltsbreite, kein waagerechter Überlauf, Admin und Beobachter; grün
- [ ] 6.3 `e2e/stab-kontrast.spec.ts`, `e2e/stab-checkliste.spec.ts` (Einklappen nach 7/7 und Neuladen), `e2e/gate1-ueberlauf.spec.ts` (Stab-Route), `e2e/lagebesprechung.spec.ts` und `e2e/einsatzkopf-live.spec.ts` (Stab-Zeile) nachgezogen und grün
- [ ] 6.4 `pruefliste.md` dieser Change: Prüfliste Einsatztauglichkeit (15 Kriterien, Festlegung 7 der Bedien-Leitlinie) mit Verdikt und Beleg je Zeile für `/einsaetze/:id/stab` und das Paneel „Lücken“ des Funkplans

## 7. Abschluss

- [ ] 7.1 Nach dem Merge von PR #726: `alpha` in den Branch mergen, Konflikte in `stab/`, `StabPage.tsx`, `stab/AGENTS.md` lösen, Vitest der berührten Dateien grün
- [ ] 7.2 `./scripts/check-all.sh` grün (Bündel `schnell` und `frontend`, e2e der Stab-Specs; Lauf im PR belegt den Rest)
- [ ] 7.3 `/opsx:archive o5nxgqbl-stab-uebersicht` im selben Branch (Spec-Sync, neue Fähigkeit `stab-uebersicht`, Verweise auf den Change-Pfad in `stab/AGENTS.md` und Code-Kommentaren nachgezogen), dann PR gegen `alpha` mit Hinweis „Design System nachziehen (Werkzeugzelle, Kachel)“
