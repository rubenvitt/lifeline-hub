# Tasks

Zunder: https://zunder.rubeen.dev/#/aufgabe/teqsdpaseizlqofi9p81fs6v (LLH-1665)

Jede Gruppe bringt ihre Tests und Doku mit. „Lokaler Lauf“ heißt: in `frontend/`
`mise exec -- pnpm exec playwright test --project=chromium <spec>` gegen das Debug-Binary des
Branches, bei Umbauten an Messfällen zusätzlich `--repeat-each=3`. Vorher-Nachher-Zeiten stehen
in `pruefliste.md` dieser Change.

## 1. Ausgangslage festhalten

- [ ] 1.1 `pruefliste.md` anlegen: Chromium-Summe der eingecheckten `laufzeiten.json` (335,4 min) und die Zeiten der 20 längsten Specs als Vorher-Werte; je Spec, die diese Change umbaut, einen lokalen Vorher-Lauf (Dauer, Testzahl) eintragen. Verifiziert: Tabelle steht, Testzahlen stimmen mit `playwright test --list` überein.

## 2. Regel und Riegel

- [x] 2.1 Regel in `frontend/e2e/AGENTS.md`: e2e nur für Abläufe über mehrere Seiten und für das, was nur der Browser zeigt; Logik einer Seite in Vitest, Serververhalten in `tests/`; Layout-Gates laufen in jedem Lauf vollständig (D1); Anmeldung per API (D2); eine Ladung je Dichtestufe (D3). Verifiziert: Prettier über `frontend/` grün, Verweis auf diese Change steht.

## 3. Anmelde-Kern und Umstellung der Anmeldung (D2)

- [x] 3.1 `e2e/anmelde-kern.ts` mit `anmeldenPerApi(page, benutzer, passwort, { startseite })` per TDD gegen eine kleine Probe-Spec: mit Startseite steht `/einsaetze` mit dem Benutzer im Menü, ohne Startseite ist keine Seite geladen und das erste `goto` zeigt den Benutzer; ein Konto unter Änderungszwang meldet einen klaren Fehler. Verifiziert: lokaler Lauf der Probe grün, Mutationsprobe (Zusicherung auf die Sitzung entfernt → Fall mit Änderungszwang wird nicht mehr rot) festgehalten.
- [ ] 3.2 `anmelden` (`trefflaeche-kern.ts`), `anmeldenAls`, `anmeldenAlsAdmin`, `wechsleZu`, `wechsleZuAdmin` (`rollen-kern.ts`), `anmeldenOhneStartseite` (`lageplan-kern.ts`) sowie die Kern-Kopien in `funkplan-kern.ts` und `meldebild-kern.ts` auf den Kern umstellen. Verifiziert: lokaler Lauf von `gate3-trefflaeche`, `gate1-ueberlauf`, `funkplan`, `meldebild*` grün.
- [ ] 3.3 Die Specs mit eigener `anmelden`/`anmeldenAls`-Kopie (rund 40) auf Importe umstellen; was eine Kopie zusätzlich tut (Dichte, Helligkeit, Modus per `addInitScript`), bleibt als eigener Schritt davor. Specs, die die Anmeldung selbst prüfen, bleiben unverändert und kommen in die Ausnahmeliste. Verifiziert: `tsc` und ESLint für `e2e/**` grün, lokaler Lauf der umgestellten Specs grün.
- [ ] 3.4 Mechanisch `startseite: false` setzen, wo der nächste Befehl nach der Anmeldung `page.goto(` ist (Skript in der Scratchpad, nicht committet). Verifiziert: Diff durchgesehen, lokaler Lauf der betroffenen Specs grün.
- [x] 3.5 Riegel `no-restricted-syntax` für `e2e/**` gegen das Ausfüllen des Anmeldeformulars außerhalb der Ausnahmeliste, mit Meldung, die auf `anmelde-kern.ts` zeigt. Verifiziert: ESLint grün; Mutationsprobe (Formular-Anmeldung in eine Gate-Spec zurückgesetzt → ESLint rot) festgehalten.

## 4. Eine Ladung je Dichtestufe (D3)

- [x] 4.1 `ladeInDichte(page, pfad, dichte)` in `trefflaeche-kern.ts` per TDD: Stufe vor dem Laden gesetzt, Wache `data-dichte`, Rückfall auf `goto` + `stelleDichte` von `about:blank`. Verifiziert: Probe-Spec zählt die Navigationen (eine je Stufe); Mutationsprobe (Schlüssel nicht gesetzt → Wache rot vor der Messung) festgehalten.
- [ ] 4.2 gate3 auf `ladeInDichte` umstellen (69 Stellen). Verifiziert: lokaler Lauf grün mit `--repeat-each=3`; Zeit gegen Vorher-Wert in `pruefliste.md`.
- [ ] 4.3 `fokus-verdeckung`, `pegel-pruefliste`, `leisten-flaeche` umstellen; die Dichtetests von `fokus-verdeckung` (`:747`, `:2483`, `:2620`, `:2767`) je Breite zu einem Fall über `STAFFEL` bündeln. Verifiziert: lokale Läufe grün mit `--repeat-each=3`, Zeiten eingetragen.

## 5. Saat einmal (D4, D6)

- [x] 5.1 Gate-1-Durchgänge auf Schreibzugriffe prüfen (`vorbereiten`, `lesend`) und das Ergebnis in `pruefliste.md` festhalten. Verifiziert: Liste der lesenden Durchgänge steht.
- [ ] 5.2 `gate1Vorbereiten` als Worker-Fixture für die lesenden Durchgänge (Einsatz mit und ohne `vorlage`, Beobachter je Einsatz); schreibende Durchgänge säen weiter je Test. Freistellungs- und Tot-Erkennung unverändert. Verifiziert: lokaler Lauf grün mit `--repeat-each=2`; Mutationsprobe aus `layout-gates-rollen` (Rechtehinweis breiter als 390 px → Beobachter rot, Admin grün) wiederholt.
- [ ] 5.3 Titel- und h1-Prüfung aus `orientierung.spec.ts:40` in den Admin-Durchgang von Gate 1 auf 1366 px für die Routen, die Gate 1 lädt; `orientierung` behält die übrigen Module. Verifiziert: Routenabgleich in `pruefliste.md`, Mutationsprobe (falscher Seitentitel eines Moduls → Gate 1 rot) festgehalten.
- [ ] 5.4 Admin-/Beobachter-Geschwister mit gleicher Saat in gate3, `trefflaeche-pruefflaechen`, `leisten-flaeche`, `pegel-pruefliste` zu je einem Fall mit `test.step('Admin …')` / `test.step('Beobachter …')` zusammenlegen. Verifiziert: Inventar der Paare in `pruefliste.md`; je Datei eine Mutationsprobe (nur Nicht-Admin-Zweig verbreitert → Beobachter-Schritt rot, Admin-Schritt grün); lokale Läufe grün.

## 6. Gleiche Flächen einmal laden (D5)

- [ ] 6.1 Überschneidungen gate3 ↔ `fokus-verdeckung` inventarisieren (Saat, Seite, Rolle, Breite, Stufe identisch?) und in `pruefliste.md` festhalten. Verifiziert: Inventar steht mit Zeilenverweisen.
- [ ] 6.2 Die identischen Fälle in gate3 zusammenführen (Fokusmessung über `fokus-kern.ts`), die Gegenstücke in `fokus-verdeckung` streichen. Verifiziert: je zusammengeführtem Fall eine Mutationsprobe für Trefffläche und eine für Fokus (beide rot im gemeinsamen Fall); lokale Läufe grün.

## 7. Duplikate streichen oder verschieben (D7)

- [ ] 7.1 `funkplan.spec.ts:211`, `:231`, `:254` streichen (Gegenstücke `FunkplanPage.test.tsx:386`, `:427`, `:280`); `:458` (Sprechgruppen) als Vitest-Fall in `FunkplanPage.test.tsx` neu. Verifiziert: je Fall Mutationsprobe am Vitest-Gegenstück festgehalten; Vitest und lokaler e2e-Lauf grün.
- [ ] 7.2 `lagekarte-smoke.spec.ts:763` streichen (Gegenstück `tests/freies_zeichen.rs:226`). Verifiziert: Mutationsprobe am Rust-Test festgehalten.
- [ ] 7.3 `dokumente.spec.ts:385`, `:409` nach Vitest bzw. auf die bestehenden Fälle in `DokumentePage.test.tsx` zurückführen; ETB-Nachweis zum PATCH in `tests/dokument.rs` ergänzen (TDD). Verifiziert: Mutationsproben festgehalten, `cargo test --test dokument` und Vitest grün.
- [ ] 7.4 `fernmeldeskizze.spec.ts`: die Teile von `:698`, `:643` und den 403-Teil von `:1056` streichen, die `fernmeldenetz.test.ts:242`, der Eigenschaftstest D11 und `tests/stab_fernmeldeskizze.rs:154/:201` belegen; UI-Meldungen bleiben. Verifiziert: Mutationsproben festgehalten, lokaler Lauf grün.
- [ ] 7.5 `command-palette.spec.ts:198`: Rangfolge streichen (Gegenstück `befehle.test.ts:1028`), Navigieren bleibt; Einsatz per API statt Dialog, wo der Dialog nicht geprüft wird. Verifiziert: Mutationsprobe festgehalten, lokaler Lauf grün.
- [ ] 7.6 Gefahrenmatrix `trefflaeche-pruefflaechen.spec.ts:1761`: Deckungsprüfung nach gate3 `:5073` übernehmen, Fall streichen. Verifiziert: Mutationsprobe (eine Matrixzelle unter Soll) macht gate3 rot.

## 8. `kopfhoehe-tonpruefung` (D7)

- [x] 8.1 Herleitung der Messdauer (LFH-637, LLH-1232) lesen und entscheiden, ob Messdauer „Endstand + Nachlauf“ und Beobachter nur in den Sprungbändern tragen; Entscheidung mit Begründung in `pruefliste.md`. Trägt sie, umsetzen. Verifiziert: Mutationsprobe (später Kopfsprung nach Endstand bzw. in einem Band) bleibt rot; lokaler Lauf grün. Trägt sie nicht: Spec unverändert, Begründung steht.

## 9. Gesamtnachweis

- [ ] 9.1 `./scripts/check-all.sh` grün (lokal die Bündel `schnell` und `frontend`, e2e über die CI des PRs; Verweis auf den Lauf). Verifiziert: Ausgabe bzw. Lauf-URL in `pruefliste.md`.
- [ ] 9.2 Lokale Bilanz: Summe der Vorher-Nachher-Differenzen aller umgebauten Specs (Chromium, Testzeit) in `pruefliste.md`. Verifiziert: Senkung ≥ 34 min; sonst Befund dem Menschen vorlegen, bevor die Change archiviert wird.
- [ ] 9.3 Code-Review (`superpowers:requesting-code-review`) und bestätigte Findings abgearbeitet. Verifiziert: Findings-Liste in `pruefliste.md` mit Erledigt-Vermerk.

## Workflow follow-up

- Spec-Sync und Archiv (`/opsx:archive teqsdpas-e2e-testpyramide`) im selben Branch vor dem PR,
  Verweise auf den Change-Pfad (`frontend/e2e/AGENTS.md`) nachziehen.
- PR gegen `alpha`, Bilder: keine sichtbare Wirkung (nur Tests und Regeln), Satz dazu im PR.
- Nach dem ersten grünen CI-Lauf des PRs: `frontend/e2e/laufzeiten.json` aus dem Artefakt
  `e2e-laufzeiten` auffrischen (`node scripts/e2e-anteile.mjs aktualisieren …`) und als Commit in
  den PR. Die Chromium-Summe gegen 335,4 min vergleichen, das Ergebnis in die archivierte
  `pruefliste.md` schreiben. Akzeptanz: Senkung ≥ 10 % (≥ 34 min).
