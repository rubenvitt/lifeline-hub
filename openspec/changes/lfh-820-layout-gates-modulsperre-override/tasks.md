# Tasks

## 1. Inventar und Vorlauf

- [ ] 1.1 `pruefliste.md` in dieser Change anlegen: Nachtrag zum LFH-435-Inventar für `nav-schmal` und `lage-dashboard-schmal` (Sperrzweig, Fundstellen in `ModulPanel.tsx`, `ModulAkkordeon.tsx`, `LageDashboardPage.tsx`, `LagePaneele.tsx`), Verdikt vorerst „offen“. Prüfen: Datei existiert, beide Zeilen stehen darin
- [ ] 1.2 Laufzeit beider Specs vorher messen (`playwright test e2e/nav-schmal.spec.ts e2e/lage-dashboard-schmal.spec.ts --reporter=dot`) und in `pruefliste.md` festhalten. Prüfen: Zeile „vorher“ mit Dauer und Testzahl steht

## 2. Navigationsrahmen mit Modulsperre (`nav-schmal`)

- [ ] 2.1 Startroute und rollenneutralen Anker für den Beobachter wählen und die zu sperrenden Module nach D3 festlegen (Modul der offenen Kategorie, ggf. Sprungmarken-Ziel). Ein lokaler Helfer `modulSperren(page, einsatzId, key)` sichert die Override-Antwort zu. Prüfen: der Helfer scheitert laut bei einem ungültigen Key (einmal lokal mit falschem Key ausprobiert)
- [ ] 2.2 Test „… auf 390 px (Beobachter, Modulsperre)“: Admin legt Einsatz an und sperrt, `wechsleZuRolle(page, 'beobachter', id)`, Drawer öffnen, Vorbedingung nach D4 (gesperrte Zeile `toBeDisabled`, Titel „Keine Berechtigung“), dann `messeUeberlauf` für Drawer zu und offen, Hamburger- und Schließen-Trefffläche. Prüfen: Test grün
- [ ] 2.3 Test „… auf 1024 px inline (Beobachter, Modulsperre)“: Navigation „Kategorien“ sichtbar, Hamburger abwesend, gesperrte Zeile gesperrt, `messeUeberlauf` ohne Treffer im Rahmen. Prüfen: Test grün
- [ ] 2.4 Mutationsproben nach D6 (Schloss-Hülle `minWidth: 2000`; `disabled` auf `false`) fahren: Beobachter-Tests rot mit zugeordneter Ursache, Admin-Tests grün. Ergebnis in `pruefliste.md`, Mutation verworfen. Prüfen: Tabelle hat beide Zeilen, `git diff --stat frontend/src` leer

## 3. Lage-Dashboard mit Modulsperre (`lage-dashboard-schmal`)

- [ ] 3.1 Öffner für den Sperrdurchgang: eigener Einsatz (nicht `einsatzId ??=`), Override für `personen`, `gefahrenzonen`, `etb`, Wechsel auf den Beobachter, Viewport setzen, Dashboard öffnen. Anker: sechs Plätze `[data-lfh="kennzahl"]`. Prüfen: die Admin-Tests der Datei laufen unverändert grün
- [ ] 3.2 Je Prüfbreite (1366, 1024, 390) ein Test „… (Beobachter, Modulsperre)“: Vorbedingung nach D4 (Platz mit „—“ und „nicht freigegeben“ ohne Link, Gefahrenpaneel „Modul Gefahren nicht freigegeben.“), dann dieselben Zusicherungen wie der Admin-Test der Breite (Spaltenzahl, `keinWaagerechterUeberlauf`, `jedeKennzahlStehtInIhrerZelle`). Prüfen: drei Tests grün
- [ ] 3.3 Mutationsproben nach D6 (gesperrter Platz mit Wert `minWidth: 2000`; gesperrter Zweig auf den normalen umgebogen) fahren: Sperrdurchgänge rot mit zugeordneter Ursache, Admin-Tests grün. Ergebnis in `pruefliste.md`, Mutation verworfen. Prüfen: Tabelle hat beide Zeilen, `git diff --stat frontend/src` leer

## 4. Regel und Abschluss

- [ ] 4.1 `frontend/e2e/AGENTS.md`, LFH-435-Zeile: Override-Achse nennen (Sperre per Einsatz-Override säen, Beobachter betrachtet, Vorbedingung „gesperrte Zeile steht“) mit Verweis auf diese Change. Prüfen: `prettier --check frontend/e2e/AGENTS.md` grün
- [ ] 4.2 Befunde nach D5 behandeln, falls ein Durchgang rot geboren wurde (lokal beheben mit Nachweis oder `test.fixme` mit Ticket). Verdikte in `pruefliste.md` auf „erfüllt“ bzw. Ticketnummer setzen. Prüfen: kein Verdikt „offen“ mehr
- [ ] 4.3 Laufzeit nachher messen (Befehl aus 1.2) und in `pruefliste.md` festhalten. Prüfen: Zeile „nachher“ steht
- [ ] 4.4 `pnpm lint` und `pnpm exec tsc -b` für `frontend/` grün, danach `./scripts/check-all.sh` (bzw. die CI des PRs). Prüfen: Lauf grün oder rote Schritte mit Ursache in `pruefliste.md`
