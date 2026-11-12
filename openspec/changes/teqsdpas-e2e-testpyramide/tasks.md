# Tasks

Zunder: https://zunder.rubeen.dev/#/aufgabe/teqsdpaseizlqofi9p81fs6v (LLH-1665)

Jede Gruppe bringt ihre Tests und Doku mit. „Lokaler Lauf“ heißt: in `frontend/`
`mise exec -- pnpm exec playwright test --project=chromium <spec>` gegen das Debug-Binary des
Branches. Vorher-Nachher-Zeiten stehen in `pruefliste.md` dieser Change. Nachweis der Umbauten
(Entscheidung 12.11.2026, statt `--repeat-each`): der Messlauf der 10 Specs, der Lauf der übrigen
geänderten Specs und der CI-Lauf des PRs.

## 1. Ausgangslage festhalten

- [x] 1.1 `pruefliste.md` anlegen: Chromium-Summe der eingecheckten `laufzeiten.json` (335,4 min) und die Zeiten der 20 längsten Specs als Vorher-Werte; lokaler Vorher-Lauf für eine Auswahl von 10 umgebauten Specs (der Lauf über alle 20 brauchte lokal zu lange und wurde abgebrochen, Entscheidung 12.11.2026). Verifiziert: Tabelle und Vorher-Lauf stehen in `pruefliste.md`.

## 2. Regel und Riegel

- [x] 2.1 Regel in `frontend/e2e/AGENTS.md`: e2e nur für Abläufe über mehrere Seiten und für das, was nur der Browser zeigt; Logik einer Seite in Vitest, Serververhalten in `tests/`; Layout-Gates laufen in jedem Lauf vollständig (D1); Anmeldung per API (D2); eine Ladung je Dichtestufe (D3). Verifiziert: Prettier über `frontend/` grün, Verweis auf diese Change steht.

## 3. Anmelde-Kern und Umstellung der Anmeldung (D2)

- [x] 3.1 `e2e/anmelde-kern.ts` mit `anmeldenPerApi(page, benutzer, passwort, { startseite })` per TDD gegen eine kleine Probe-Spec: mit Startseite steht `/einsaetze` mit dem Benutzer im Menü, ohne Startseite ist keine Seite geladen und das erste `goto` zeigt den Benutzer; ein Konto unter Änderungszwang meldet einen klaren Fehler. Verifiziert: lokaler Lauf der Probe grün, Mutationsprobe (Zusicherung auf die Sitzung entfernt → Fall mit Änderungszwang wird nicht mehr rot) festgehalten.
- [x] 3.2 `anmelden` (`trefflaeche-kern.ts`), `anmeldenAls`, `anmeldenAlsAdmin`, `wechsleZu`, `wechsleZuAdmin` (`rollen-kern.ts`), `anmeldenOhneStartseite` (`lageplan-kern.ts`) sowie die Kern-Kopien in `funkplan-kern.ts` und `meldebild-kern.ts` auf den Kern umstellen. Verifiziert: lokaler Lauf von `gate3-trefflaeche`, `gate1-ueberlauf`, `funkplan` grün (Messlauf), `meldebild*` im Lauf der übrigen Specs.
- [ ] 3.3 Den Formularblock (Anmeldeseite, Benutzername, Passwort, Klick, Einsatzliste) in den Specs per Skript durch `anmeldenPerApi` ersetzen, auch in lokalen `anmelden`-Hüllen (140 Stellen); was eine Hülle zusätzlich tut (Dichte, Helligkeit, Modus per `addInitScript`), bleibt als eigener Schritt davor. Specs, die die Anmeldung selbst prüfen, bleiben unverändert und kommen in die Ausnahmeliste. Verifiziert: `tsc` und ESLint für `e2e/**` grün, lokaler Lauf der umgestellten Specs grün.
- [ ] 3.4 Mechanisch `startseite: false` setzen, wo der nächste Befehl nach der Anmeldung `page.goto(` ist (Skript in der Scratchpad, nicht committet). Verifiziert: Diff durchgesehen, lokaler Lauf der betroffenen Specs grün.
- [x] 3.5 Riegel `no-restricted-syntax` für `e2e/**` gegen das Ausfüllen des Anmeldeformulars außerhalb der Ausnahmeliste, mit Meldung, die auf `anmelde-kern.ts` zeigt. Verifiziert: ESLint grün; Mutationsprobe (Formular-Anmeldung in eine Gate-Spec zurückgesetzt → ESLint rot) festgehalten.
- [ ] 3.6 `einsatzPerApi` in `e2e/einsatz-kern.ts`; per Skript dort statt `einsatzAnlegen` (Dialog), wo der Fall den Dialog nicht prüft und danach per `goto` lädt (91 Stellen). Verifiziert: gleiche Werte wie der Dialog (Server-Vorgaben Einsatzart und Alarmzeit), `tsc`/ESLint grün, Lauf der übrigen Specs grün.

## 4. Eine Ladung je Dichtestufe (D3)

- [x] 4.1 `ladeInDichte(page, pfad, dichte)` in `trefflaeche-kern.ts` per TDD: Stufe vor dem Laden gesetzt, Wache `data-dichte`, Rückfall auf `goto` + `stelleDichte` von `about:blank`. Verifiziert: Probe-Spec zählt die Navigationen (eine je Stufe); Mutationsprobe (Schlüssel nicht gesetzt → Wache rot vor der Messung) festgehalten.
- [x] 4.2 gate3 auf `ladeInDichte` umstellen (69 Stellen). Verifiziert: Messlauf grün; Zeit gegen Vorher-Wert in `pruefliste.md`.
- [ ] 4.3 `fokus-verdeckung`, `pegel-pruefliste`, `leisten-flaeche` und die übrigen Specs mit `goto` + gleichwertigem `stelleDichte` umstellen (116 Stellen in 20 Specs). Verifiziert: Messlauf und Lauf der übrigen Specs grün, Zeiten eingetragen.

## 5. Saat einmal (D4)

- [x] 5.1 Gate-1-Durchgänge auf Schreibzugriffe prüfen (`vorbereiten`, `lesend`) und das Ergebnis in `pruefliste.md` festhalten. Verifiziert: Liste der lesenden Durchgänge steht.
- [x] 5.2 `gate1Vorbereiten` mit Saat einmal je Worker-Prozess für die lesenden Durchgänge (Einsatz mit und ohne `vorlage`, ein Beobachter als Mitglied jedes Einsatzes); schreibende Durchgänge säten weiter je Test. Freistellungs- und Tot-Erkennung unverändert. Verifiziert: Messlauf grün (je Worker 24 Tests auf derselben Saat); Mutationsprobe aus `layout-gates-rollen` (Rechtehinweis breiter als 390 px → Beobachter rot, Admin grün) wiederholt.
## 6. Duplikate streichen oder verschieben (D7)

- [x] 6.1 `funkplan.spec.ts:254` (Zeilenlink) streichen, Gegenstück `FunkplanPage.test.tsx` „führt jede Zeile per Link zu ihrem Pflegeort“; `:211`, `:231` (Übernahme in Bericht/Befehl) und `:458` (Sprechgruppen → Einsatzdaten) bleiben als Abläufe über mehrere Seiten. Verifiziert: Mutationsprobe am Vitest-Gegenstück festgehalten.
- [x] 6.2 `lagekarte-smoke.spec.ts:763` streichen (Gegenstück `tests/freies_zeichen.rs:226`). Verifiziert: Mutationsprobe am Rust-Test festgehalten.
- [x] 6.3 `dokumente.spec.ts:303`, `:396` geprüft: bleiben (Upload-Fortschritt, Download-Dateiname und Dialog nur im Browser; der ETB-Abruf kostet keine Ladung). Verifiziert: Begründung in `pruefliste.md`.
- [x] 6.4 `fernmeldeskizze.spec.ts:643`, `:698`, `:1056` geprüft: bleiben (die Teile hängen an Seiten, die der Fall ohnehin lädt; Streichen spart keine Ladung). Verifiziert: Begründung in `pruefliste.md`.
- [x] 6.5 `command-palette.spec.ts:198` geprüft: bleibt (Ablauf ETB → Fernmeldewesen über die Palette; die Rangfolge ist ein Nebenbefund); Einsätze ohne Dialogprüfung über 3.6. Verifiziert: Begründung in `pruefliste.md`.
- [x] 6.6 Gefahrenmatrix `trefflaeche-pruefflaechen.spec.ts:1761`: Deckungsprüfung nach gate3 `:5073` übernehmen, Fall streichen. Verifiziert: Mutationsprobe (eine Matrixzelle unter Soll) macht gate3 rot.

## 7. `kopfhoehe-tonpruefung` (D7)

- [x] 7.1 Herleitung der Messdauer (LFH-637, LLH-1232) lesen und entscheiden, ob Messdauer „Endstand + Nachlauf“ und Beobachter nur in den Sprungbändern tragen; Entscheidung mit Begründung in `pruefliste.md`. Trägt sie, umsetzen. Verifiziert: Mutationsprobe (später Kopfsprung nach Endstand bzw. in einem Band) bleibt rot; lokaler Lauf grün. Trägt sie nicht: Spec unverändert, Begründung steht.

## 8. Gesamtnachweis

- [ ] 8.1 `./scripts/check-all.sh` grün (lokal die Bündel `schnell` und `frontend`, e2e über die CI des PRs; Verweis auf den Lauf). Verifiziert: Ausgabe bzw. Lauf-URL in `pruefliste.md`.
- [x] 8.2 Lokale Bilanz der Auswahl (vorher/nachher, Chromium, Testzeit) in `pruefliste.md` und dem Menschen vor dem Archiv vorgelegt. Verifiziert: 147,1 → 113,8 min über die in beiden Läufen grünen Fälle (−23 %), vorgelegt am 12.11.2026; Entscheidung: Akzeptanz über den CI-Lauf, D5/D6 nur bei Bedarf.
- [x] 8.3 Code-Review (`superpowers:requesting-code-review`) und bestätigte Findings abgearbeitet. Verifiziert: Findings-Liste in `pruefliste.md` mit Erledigt-Vermerk.

## Workflow follow-up

- **Nur falls der CI-Lauf des PRs unter 34 min Ersparnis bleibt** (Entscheidung 12.11.2026,
  design.md D5/D6), sonst entfallen sie:
  - Titel- und h1-Prüfung aus `orientierung.spec.ts:40` in den Admin-Durchgang von Gate 1
    (1366 px) für die Routen, die Gate 1 lädt; Mutationsprobe falscher Seitentitel.
  - Admin-/Beobachter-Geschwister mit gleicher Saat in gate3, `trefflaeche-pruefflaechen`,
    `leisten-flaeche`, `pegel-pruefliste` zu je einem Fall mit `test.step` zusammenlegen; je
    Datei Mutationsprobe (nur Nicht-Admin-Zweig → Beobachter-Schritt rot, Admin grün).
  - Überschneidungen gate3 ↔ `fokus-verdeckung` inventarisieren und identische Fälle in gate3
    zusammenführen; Mutationsprobe je Eigenschaft. Dichtetests von `fokus-verdeckung` (`:747`,
    `:2483`, `:2620`, `:2767`) je Breite bündeln.

- Spec-Sync und Archiv (`/opsx:archive teqsdpas-e2e-testpyramide`) im selben Branch vor dem PR,
  Verweise auf den Change-Pfad (`frontend/e2e/AGENTS.md`) nachziehen.
- PR gegen `alpha`, Bilder: keine sichtbare Wirkung (nur Tests und Regeln), Satz dazu im PR.
- Nach dem ersten grünen CI-Lauf des PRs: `frontend/e2e/laufzeiten.json` aus dem Artefakt
  `e2e-laufzeiten` auffrischen (`node scripts/e2e-anteile.mjs aktualisieren …`) und als Commit in
  den PR. Die Chromium-Summe gegen 335,4 min vergleichen, das Ergebnis in die archivierte
  `pruefliste.md` schreiben. Akzeptanz: Senkung ≥ 10 % (≥ 34 min).
