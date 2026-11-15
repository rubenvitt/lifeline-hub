# Tasks

## 1. Platz der Marke (D1)

- [x] 1.1 Test in `frontend/src/einsatz/sprungmarken.test.ts`: jede Marke steht in der Kategorie ihres Zielmoduls; die Reihenfolge der Kategorien Führung (ohne `↗entscheidungen`) und Erfassung (`etb`, `↗entscheidungen`, `personen`, …) ist erwartet; der Fall „Anker fehlt“ nutzt ETB statt Aufträge. Erst rot, verifiziert mit `mise exec -- pnpm exec vitest run src/einsatz/sprungmarken.test.ts` in `frontend/`
- [x] 1.2 `sprungmarken.ts`: „Entscheidungen“ auf `kategorie: 'erfassung'`, `nach: 'etb'`, Kopfkommentar nachziehen (die Marke steht in der Kategorie ihres Ziels); Test aus 1.1 grün
- [x] 1.3 `command-palette/befehle.test.ts` und alle weiteren Tests, die „Entscheidungen“ in der Führung erwarten, laufen grün (`mise exec -- pnpm exec vitest run src/command-palette src/einsatz`)

## 2. Unteransicht im Menü (D2–D4)

- [ ] 2.1 Test in `frontend/src/einsatz/ModulPanel.test.tsx`: eine Markenzeile trägt kein Pfeil-Symbol, gesperrt das Schloss, und `sprungZeilenStil` liefert Einzug und Linie in `linie` bei gleicher Mindesthöhe wie `modulZeilenStil` (auch mit `mindestTrefflaeche`); erst rot
- [ ] 2.2 `ModulPanel.tsx`: `sprungZeilenStil` und die neue Markenzeile ohne `IconExternPfeil`, Kommentar zum zugänglichen Namen ohne Pfeil; Test aus 2.1 grün, bestehende Tests der Datei grün
- [ ] 2.3 `frontend/e2e/nav-schmal.spec.ts`: gesperrte Marke „Entscheidungen“ in der Kategorie Erfassung prüfen (ETB als gesperrte Zeile), Spec lokal grün gegen ein frisch gebautes Backend

## 3. Regeln und Doku

- [ ] 3.1 `frontend/AGENTS.md`, „Sprungmarken sind keine Module“: Marke steht in der Kategorie ihres Zielmoduls, eingerückt mit Linie, ohne Pfeil; Prettier über `frontend/` grün
- [ ] 3.2 `docs/anwender/kapitel/einsatz-oberflaeche.md`: Absatz zu Sprungmarken (Entscheidungen unter ETB in Erfassung, eingerückt unter ihrem Modul); Wächter `src/hilfe/anwenderdoku.guard.test.ts` grün
- [ ] 3.3 Bilder der Kapitel neu erzeugen, deren Bilder-Spec ein Modulmenü mit einer Marke fotografiert (mindestens `einsatz-oberflaeche`, `arbeitsflaeche`), und committen; Wächter grün

## 4. Prüfen

- [ ] 4.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün
- [ ] 4.2 Bilder der Änderung (vorher/nachher: Führung, Erfassung, Kräfte, gesperrte Marke) für PR und Meldung aufgenommen

## Workflow follow-up

- Review vor dem PR über den ganzen Branch, bestätigte Befunde behandeln.
- `/opsx:archive f11xba3p-sprungmarken-unteransicht` im selben Branch, dann PR gegen `alpha`.
