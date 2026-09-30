# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development` (erst rot, dann grün). Vor
„fertig“ kommen `verification-before-completion` und `requesting-code-review`.

## 1. Server: Modulzähler und reine Zählregeln

- [x] 1.1 In `src/einsatz/zaehler.rs` die reinen Funktionen `zaehle_auftraege` und
  `zaehle_meldungen` über die Prädikatsfelder herauslösen; `berechne` ruft sie. Beleg: Die
  bestehenden Unit-Tests und `tests/modul_zaehler.rs` bleiben grün.
- [x] 1.2 `AuftragsZaehler.in_arbeit` ergänzen: davon mit Bearbeitungsstatus „in Arbeit“. Beleg:
  Die Spec-Szenarien „Aufträge in Arbeit“ und „Vollzogener Auftrag ist nicht überfällig im
  Zähler“ stehen als Fälle in `tests/modul_zaehler.rs`, zuerst rot.
- [x] 1.3 In `src/einheit/repo.rs` die reine Funktion `kumuliere(eigene, kinder, wurzel)`
  herauslösen (zyklussicher). `Anreicherung::ist_kumuliert` ruft sie. Beleg: Die bestehenden
  Einheiten-Tests bleiben grün, und ein Unit-Test deckt den Zyklus ab.
- [x] 1.4 `scripts/check-typ-codegen.sh` laufen lassen, `openapi.json` und `types.generated.ts`
  mitcommitten. Beleg: Das Skript ist grün, und der Diff zeigt nur `in_arbeit`.

## 2. Gemeinsames Fixture — Handlungsmengen

- [x] 2.1 `tests/fixtures/verdichtung/regeln.json` mit den Abschnitten `auftraege` und
  `meldungen` anlegen. Die Fälle: vollzogen mit Quittungslücke, in Arbeit überfällig, eskaliert
  vor Frist, bestätigt nach Frist, erledigt und neu. Beleg: Die Datei parst in beiden Suiten.
- [x] 2.2 Rust-Test `tests/verdichtung_fixture.rs`: Er liest die Datei per `include_str!` und prüft
  `zaehle_auftraege` und `zaehle_meldungen`. Beleg: Grün. Mutationsprobe: `ist_offen` um
  `Vollzogen` erweitern macht ihn rot.
- [x] 2.3 Vitest `frontend/src/lage/verdichtungFixture.test.ts` (`readFileSync` wie
  `test/huelle.ts`) prüft das Überblick-`istOffen` und `meldungKennzahlen.istAlarmiert` gegen
  dieselbe Datei. Den Kommentar „wer eine ändert, ändert beide“ in `zaehler.rs` durch einen
  Verweis auf das Fixture ersetzen. Beleg: Grün. Mutationsprobe: `eskaliert` aus `istAlarmiert`
  entfernen macht ihn rot.

## 3. Stärke: eine Summe, eine Formatierung

- [x] 3.1 Das Fixture um den Abschnitt `staerke` erweitern: Einheiten, Abschnitte, BR-Mengen und
  die erwarteten Werte. Den Rust-Test um `ist_kumuliert` je Einheit gegen `kumuliere` ergänzen.
  Beleg: Grün.
- [x] 3.2 `summiereStaerke` addiert nur Wurzeln der übergebenen Menge.
  `abschnittStaerken` übergibt nur Unterstellungswurzeln des Einsatzes (Waisen wie
  `baueKraeftebild`). Beleg:
  - Vitest-Fixture-Test: `abschnittStaerken`, `summiereStaerke` (BR) und die Abschnittsstärke von
    `baueKraeftebild` treffen dieselben Erwartungen; vorher rot für „gleicher Abschnitt“.
  - `abschnittStaerke.test.ts` und `anzeige/staerke.test.ts` um die Spec-Szenarien ergänzt.
- [x] 3.3 `BrDetailPage.tsx` prüfen: Die Summe läuft über die neue Regel, und die
  Unvollständigkeitsriegel bleibt. Beleg: Ein Test „BR mit Einheit und Untereinheit zählt einmal“.
- [x] 3.4 `staerkeText` zusammenlegen: Die Formatierung bleibt nur in `anzeige/staerke.ts`,
  `kraeftebild.ts` importiert sie (Aufrufer in `lagebild.ts`, `ueberblickDaten.ts`,
  `Verdichtungszeile.tsx`, `meldebildRaster.test.ts` umstellen). Beleg: `grep -rn "function
  staerkeText" frontend/src` findet genau eine Stelle; Vitest ist grün.

## 4. Sichtung: eine Zählung

- [x] 4.1 `verdichtePersonen` (`lageVerdichtung.ts`) zählt die SK über
  `personenBilanz.sichtungsbild` und bildet nur die Schlüssel ab. Beleg: `lageVerdichtung.test.ts`
  und `personenBilanz.test.ts` bleiben unverändert grün; ein neuer Test belegt die Gleichheit
  beider Verteilungen für dieselbe Liste.

## 5. Eine Heimat für die Handlungsmengen: Dashboard und Überblick

- [x] 5.1 `pages/lage-dashboard/useLagebild.ts` aus `LageDashboardPage` herauslösen: Abfragen,
  Zustand je Quelle, Modulzähler, Basis für `baueLagebild`, ältester Stand (`standDer`). Die Abfragen `auftraege` und
  `meldungen` entfallen. Beleg:
  - `LageDashboardPage.test.tsx` bleibt grün.
  - Ein Hook-Test belegt: gesperrte Quelle ergibt `gesperrt`, Stand ist der älteste
    `dataUpdatedAt`.
- [x] 5.2 Der Führungsstand liest Aufträge und Meldungen aus dem Modulzähler. Notizen: „N
  überfällig“ bzw. „N neu · N Bestätigung überfällig“. Fehlt das Modul, heißt es „nicht
  freigegeben“; beim Laden oder Scheitern steht kein Wert. `Lagebild.fuehrung` behält nur Bericht
  und UHS. Beleg: Tests zu den Spec-Szenarien von „Handlungsmengen kommen vom Modulzähler“,
  einschließlich „vollzogen mit Quittungslücke“ und „eskaliert“.
- [x] 5.3 Die Kennzahl „Offene Aufträge“ des Führungsüberblicks liest `auftraege` aus dem
  Modulzähler (offen, `in_arbeit`, überfällig). `auftraegeKennzahl` entfällt oder wird zur reinen
  Darstellung. Beleg: `ueberblickDaten.test.ts` und `UeberblickPage.test.tsx` zu gleichen Werten
  wie der Führungsstand.
- [x] 5.4 Offline-Registry prüfen: Es kommt kein neuer Prefix; `lagebildOffline.guard.test.ts`
  bleibt grün. Beleg: Testlauf.

## 6. Vorbereitung der Lagebesprechung

- [x] 6.1 Die reine Funktion `stab/vorbereitung.ts: vorbereitungsZeilen(...)` liefert Zeilen mit
  Titel, Wert, Notiz, Quelle und Zustand in der festen Reihenfolge aus D8. Beleg: Unit-Tests zu
  „Gleiche Zahlen wie das Dashboard“ (dasselbe `Lagebild` als Eingabe), „Quellenangabe“ und
  „Betroffene gesperrt“; eine fehlende Quelle zeigt „—“ und nie 0.
- [x] 6.2 `vorbereitungMarkdown(zeilen, stand, konv)`: Stand in der Kopfzeile, Quelle je Zeile,
  Herkunftsfußzeile, Namen und Titel maskiert wie im Funkplan. Beleg: Unit-Test mit Literalen,
  darunter ein Berichtstitel mit Markdown-Zeichen.
- [x] 6.3 Paneel `stab/VorbereitungPaneel.tsx` auf der Stab-Seite unter „Lagebesprechung“, über
  `useLagebild`. Darstellung über `PaneelZeile`, Mono mit `tabular-nums` für Zahlen, „Stand
  HH:MM“ im `meta`. Beleg: `StabPage.test.tsx`; eine neue Meldung per Invalidierung erhöht den
  Wert ohne Neuladen.
- [x] 6.4 „In Lagebericht übernehmen“: Ein Aufruf `POST …/lageberichte` (`freitext`, `text`),
  Titel „Vorbereitung Lagebesprechung <DTG>“. Gesperrt, solange eine Quelle lädt; ohne
  Schreibrecht oder Lageberichtsfreigabe fehlt die Aktion; nach Erfolg öffnet sich der Bericht,
  ein Fehler steht per `SpeicherFehler` an der Seite. Beleg: Komponententests zu „Übernahme
  gelingt“, „Ohne Schreibrecht“ und „Übernahme scheitert“ (kein zweiter Request, kein Toast bei
  Fehler).
- [x] 6.5 „Nichts wird eingefroren“: Das Abschließen der Lagebesprechung bleibt unverändert. Beleg:
  `LagebesprechungModal.test.tsx` und `lagebesprechungAbschluss.test.ts` unverändert grün; im
  Diff keine Änderung an `src/stab/`.
- [x] 6.6 e2e `frontend/e2e/stab-vorbereitung.spec.ts`:
  - Als Admin: Die Werte der Vorbereitung stimmen mit dem Dashboard überein, und die Übernahme
    erzeugt einen Bericht.
  - Als Beobachter über `e2e/rollen-kern.ts`: Die Aktion fehlt, und der Lagestand steht.
  - Die Trefferfläche des Übernahmeknopfs wird geklickt, nicht nur `toBeVisible`.
  - Beleg: `pnpm e2e -- stab-vorbereitung` ist grün.
- [ ] 6.7 Die Prüfliste Einsatztauglichkeit (15 Kriterien) für die umgebaute Stab-Seite liegt als
  `pruefliste.md` in dieser Change; jede Zeile hat ein Verdikt. Beleg: Die Datei existiert, und
  keine Zeile steht auf „nicht geprüft“.

## 7. Doku und Abschluss

- [x] 7.1 In `CLAUDE.md` eine Regelzeile „Eine Heimat je Zahl (LFH-550)“ ergänzen: die Tabelle aus
  D1 in Kurzform, den Verweis auf das Fixture und den Archivpfad dieser Change. Den Nachzug zum
  Warnton des überfälligen Termins als ClickUp-Ticket anlegen (`clickup-task-anlegen`). Beleg:
  Die Zeile steht, und die Ticketnummer steht im Design unter Non-Goals.
- [ ] 7.2 `./scripts/check-all.sh` grün (Schritte 1–13). Beleg: Gesamtstatus des Laufs bzw. die
  CI des PR.
- [ ] 7.3 `/opsx:archive lfh-550-lagebesprechung-eine-verdichtung` im selben Branch: Spec-Sync
  nach `openspec/specs/` und Verweise auf den Archivpfad nachziehen. Beleg:
  `scripts/check-openspec-archiv.sh` ist grün.
