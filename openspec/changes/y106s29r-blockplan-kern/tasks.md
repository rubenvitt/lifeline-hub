# Tasks

Jede Gruppe ist ein eigener Commit und für sich grün (`cargo test` der genannten Ziele bzw. vitest
der genannten Dateien). Ab Gruppe 2 bleiben die Tests aus Gruppe 1 unverändert grün; das ist der
Beleg für Gleichverhalten.

## 1. Gleichverhalten festschreiben (nur Tests)

- [x] 1.1 `tests/schichtplan.rs`: exakte Texte und Codes absichern, TDD-Vorgabe: gegen den heutigen Code grün. Zu prüfen:
  - Überschneidung samt Zeitzone (Einsatz-Zone ≠ Org-Zone)
  - CAS-Text bei veralteter `version`
  - „Die Pause hat kein Soll“
  - fremder Helfer, fremde Person, fremde Qualifikation (am Helfer und in `quali_soll`)
  - Posten-Texte (Einheit fremd/aufgelöst, UHS fremd)
  - Ad-hoc-Text
  - „erzeugen“ ohne Länge und ohne Schichtmodell
  - `PAUSE_OFFEN` (409) und belegter Block ohne Personal (403) beim Löschen
- [x] 1.2 `tests/planung.rs`: dieselben Texte und Codes für die Planung. Dazu:
  - 422 „Eine Planung kennt nur Stamm-Personal und Helfer“
  - „Der Posten hat keine Schichtlänge …“
  - Zeitzone der Organisation im Überschneidungstext
  - `stand` steigt auf jedem Block- und Helferweg
  - 409 auf allen Block- und Helferwegen einer übernommenen Planung
- [x] 1.3 Reihenfolge je Seite in beiden Testdateien festschreiben: Einsatz nach Art, Einheitensortierung und Name; Planung nach Posten-Sortierung; Personen je Block in Einfügefolge. Gegen den heutigen Code grün.
- [x] 1.4 Höchstzahlen je Seite, mit Seed-SQL statt Schleife: „Höchstens 2000 Schichten je …“ und „Höchstens 500 Helfer je …“. Gegen den heutigen Code grün.
- [x] 1.5 Frontend: einen gemeinsamen Testsatz `abloesung/schichtplan/planEditor.cases.tsx` gegen beide Hüllen ausführen (`SchichtplanAnsicht.test.tsx`, `PlanungSchichtplan.test.tsx`). Abzudecken:
  - Zug ergibt den PATCH-Body
  - Kopie mit und ohne Personen
  - Löschen schließt nur den eigenen Dialog
  - Erfolgsmeldung beim Erzeugen
  - Ansagen-Texte
  - Gegen den heutigen Code grün.

## 2. Backend-Kern: Hilfen und Helfer

- [ ] 2.1 `src/abloesung/schichtplan/plan_repo.rs` anlegen: `trait Planart` mit Konstanten (D1) und Markern `Einsatzplan`/`Vorplanung`. Dazu die gemeinsamen Hilfen (`utc`, `json_ids` aus `PlanPerson`, `quals_json`, `zeitraum_text`, Qualifikations- und Anzahlprüfung, Pause ohne Soll). Beide Repos rufen nur noch diese. Prüfen: `cargo test --lib`, `--test schichtplan`, `--test planung`.
- [ ] 2.2 Helferwege in den Kern legen: laden, anlegen, ändern, löschen, `_tx`-Varianten für die Demo. Kennung und Herkunft nur beim Einsatz. Nachziehen über `after_write_tx`, Schreibschutz über `before_write_tx`. Prüfen: `--test schichtplan`, `--test planung`, `--test planung_uebernahme`, `--test schichtplan_kopplung`, Demo-Seed-Test.

## 3. Backend-Kern: Blöcke und Laden

- [ ] 3.1 Personen prüfen und schreiben in den Kern legen; der Ad-hoc-Zweig hängt an `MIT_ADHOC`. Prüfen: Tests aus 1.1/1.2 grün.
- [ ] 3.2 Block anlegen, ändern und löschen über den Kern. Posten-Prüfung, Insert, Überschneidung, Zeitzone und Löschprüfungen sind Methoden der Art (D2). Prüfen: `--test schichtplan`, `--test planung`, `--test schichtplan_wechsel`, `--test schichtplan_kopplung`.
- [ ] 3.3 „Schichten erzeugen“: Die Konfliktschleife liegt im Kern. Teilung, ETB-Satz und Rückgabe bleiben je Seite. Prüfen: Tests zu „erzeugen“ beider Seiten.
- [ ] 3.4 Laden: Das gemeinsame Grundgerüst baut eine neutrale Blockstruktur mit Prüfbefunden (D3). Die Planung bekommt `jetzt` übergeben. Prüfen:
  - `--test schichtplan`, `--test planung`
  - `src/planung/tests.rs`
  - `--test schichtplan_export`, `--test schichtplan_buendel`
  - `scripts/check-typ-codegen.sh` ohne Diff
- [ ] 3.5 Die Routen teilen `HelferAnlegen`/`HelferAendern`, `VersionParams` und die Personen-Übersetzung (D5). Prüfen: `cargo test` der Routen-Tests beider Seiten und `scripts/check-typ-codegen.sh` ohne Diff.

## 4. Frontend: ein Editor

- [x] 4.1 `abloesung/schichtplan/SchichtplanEditor.tsx` mit Adapter-Interface anlegen (D6) und `SchichtplanAnsicht` zur Hülle machen. Prüfen:
  - Testsatz aus 1.5 grün
  - `AbloesungPage.test.tsx` grün
  - `pnpm typecheck`, `pnpm lint`
- [ ] 4.2 `PlanungSchichtplan` zur Hülle machen. Prüfen: Testsatz aus 1.5, `PlanungPage.test.tsx`, `planungZeilen.test.ts`.
- [ ] 4.3 Den gemeinsamen Druckinhalt nach `abloesung/schichtplan/ausgabe/SchichtplanDruckInhalt.tsx` legen. Beide Druckseiten behalten ihre Hülle. Prüfen:
  - `SchichtplanDruckPage.test.tsx`, `PlanungDruckPage.test.tsx`
  - e2e `schichtplan-druck.spec.ts`
- [ ] 4.4 Verweise in `frontend/src/kraefte/AGENTS.md` und in den `quellen:` von `docs/anwender/` auf die neuen Pfade ziehen. Prüfen: `scripts/check-all.sh --nur schnell`.

## 5. Helferliste im Einsatz

- [ ] 5.1 `PlanungHelferListe` zu `abloesung/schichtplan/HelferListe.tsx` verallgemeinern (D7) und die Planung darauf umstellen. Prüfen: Helfer-Tests in `PlanungPage.test.tsx` unverändert grün.
- [ ] 5.2 Die Helferliste im Schichtplan des Einsatzes einbinden: Knopf „Helfer“ in der Werkzeugzeile, Kennung und Herkunft nur lesend, Sperrhinweis ohne Personal, nur lesen ohne Schreibrecht. Neue Tests zu den drei Szenarien des Spec-Deltas in `AbloesungPage.test.tsx`.
- [ ] 5.3 Anwenderdoku: im Schichtplan-Kapitel unter `docs/anwender/` den Abschnitt „Helfer“ ergänzen, `quellen:` nachziehen, Bild neu erzeugen (`pnpm doku:bilder --grep <kapitel>`). Prüfen: Doku-Wächter in `check-all.sh`.

## 6. Bezeichner nach LFH-1312

- [ ] 6.1 Eigener `refactor`-Commit mit den Umbenennungen aus D8 in den Dateien der Gruppen 2–5, Namensfamilien je Datei zusammen. Wire-Namen, Routen, Ereignisse, `data-lfh` und TS-Aliase bleiben unverändert. Prüfen:
  - `cargo test`
  - `pnpm typecheck`, `pnpm lint`
  - `scripts/check-typ-codegen.sh` ohne Diff

## 7. Abschluss

- [ ] 7.1 `./scripts/check-all.sh` voll grün. Die Zeilenbilanz (`git diff --stat origin/alpha`) steht in der PR-Beschreibung, Ziel −900 bis −1 100 ohne die Helferliste.

## Workflow follow-up

- Review vor dem PR (frischer Kontext, Befunde gegenprüfen), Bilder der Helferliste in den PR.
- `/opsx:archive` samt Spec-Sync vor dem PR, im selben Branch.
