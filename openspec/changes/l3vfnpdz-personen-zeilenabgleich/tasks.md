# Tasks

## 1. Zeilen-Route im Backend (D1)

- [x] 1.1 `GET /api/einsaetze/{id}/personen/{pid}/zeile` in `src/routes/einsatz_person.rs` und `src/app.rs`: `EinsatzLesezugriff<Personen>`, `repo::laden`, stornierte Person 404, `stelle::fordere_person`, Einheitengerät ohne Personalien, kein Audit. Beleg: Rust-Tests in `tests/einsatz_person.rs` (Antwort gleich der Listenzeile, stornierte Person 404 ohne Personalien, fremder Einsatz 404, ohne Modulrecht 403, Zugriffsprotokoll der Person bleibt leer)
- [x] 1.2 Route in jede Routenliste der Geräte in `src/geraet/mod.rs`, die `GET …/personen` führt. Beleg: Rust-Tests in `tests/geraet_kopplung.rs` (UHS-Gerät sieht eine Person seiner UHS, bekommt 404 für eine fremde; Einheitengerät bekommt die Zeile ohne Personalien)
- [x] 1.3 `AppError::NichtInListe` (404 mit `grund: "nicht_in_liste"` im Umschlag); die Zeilen-Route antwortet damit, eine unbekannte Route ohne `grund`; `ApiError.grund` im Client, nur dieser 404 nimmt die Person heraus. Beleg: Rust-Tests (`error::tests`, `tests/einsatz_person.rs`, `tests/geraet_kopplung.rs`), Vitest (`client.test.ts`, `zeilenAbgleich.personen.test.ts`: 404 ohne Grund an den Sammler)

## 2. Ereignisse mit Kennung (D3, D5)

- [x] 2.1 `sse_mit_person` in `src/routes/nachforderung.rs` sendet `person` mit `person_id`. Beleg: Rust-Test in `tests/nachforderung_person.rs`, dass die Nutzlast `person_id` trägt
- [x] 2.2 `PATCH …/einheiten/{eid}` sendet nach dem Commit `person` je versorgter Person, wenn sich Name oder Abschnitt der Einheit ändern, sonst nicht. Beleg: Rust-Test (Umbenennen meldet die versorgte Person mit `person_id`, eine Änderung ohne Name und Abschnitt nicht)
- [x] 2.3 `NamensTraeger` in `src/einsatzabschnitt/repo.rs` führt die versorgten Personen der Einheiten im Abschnitt; Umbenennen und Auflösen eines Abschnitts senden `person` je Person. Beleg: Rust-Test (Umbenennen des Abschnitts meldet die Person, die eine Einheit dieses Abschnitts versorgt)
- [x] 2.4 Abruf aus dem Bereitstellungsraum mit Ziel-Abschnitt sowie Vollzug und Rücknahme einer Abschnittsübergabe melden die versorgten Personen; die Einheiten-Route meldet gleich nach dem Speichern. Beleg: Rust-Tests in `tests/einsatz_bereitstellungsraum.rs`, `tests/abloesung.rs` und `tests/abschnitt_namenstraeger.rs` (422 nach dem Speichern meldet trotzdem)
- [x] 2.5 Über zehn Personen sendet ein Schreibweg ein einziges `person` ohne Kennung (`PERSONEN_EINZELN_MAX`). Beleg: Rust-Test in `tests/abschnitt_namenstraeger.rs` (Einheit und Abschnitt mit elf versorgten Personen)

## 3. Ziel `personen` im Frontend (D2, D4, D6, D7)

- [x] 3.1 In `frontend/src/api/einsatzPerson.ts`: Zeilenabruf `loadPersonZeile`, Vergleich `comparePersonen` nach `registrier_nr` und Projektion `toPersonAuswahl`. Beleg: Vitest in `einsatzPerson.test.ts` (Pfad ohne Audit-Route, Ordnung, Projektion ohne Freitexte)
- [x] 3.2 Flache Liste unter Prefix mit Cache-Key in `form` und Ziel `personen` in `frontend/src/live/zeilenAbgleich.ts` (Vollliste, Auswahl, Betroffene je Stelle); `ZeilenZiel` in `queryKeys.ts` erweitert; ein 404 setzt `null` ein. Beleg: Vitest in `zeilenAbgleich.personen.test.ts` (Einsortieren nach Registriernummer, Storno als 404 entfernt aus allen drei Listen ohne Listenabruf, Wechsel des Verbleibs in eine Stelle und heraus, fremde Stelle unberührt, ein 404 neben einer geladenen Zeile im selben Fenster, anderer Fehler an den Sammler, mehr als 10 Personen je Fenster an den Sammler)
- [x] 3.3 `EINSATZ_STREAM_ZIELE.person` in `frontend/src/api/queryKeys.ts`: mit Kennung Zeile `personen` plus `modulZaehler`, `betreuung`, `registrierliste`, `personenTransportmittel` und `personAnhaenge` nur dieser Person; ohne Kennung Prefixe. Beleg: Vitest in `queryKeys.test.ts` (gezielte Keys liegen unter den Prefixen von `person`, fehlende Kennung fällt zurück) und in `useEinsatzLiveStream.test.tsx` (ein `person`-Ereignis mit Kennung ruft die Personenliste nicht ab)
- [x] 3.4 Regel in `frontend/AGENTS.md`, „Gezielter Abgleich nach Payload“: der Zeilenabruf schreibt kein Zugriffsprotokoll und liefert nur Listenzeilen, 404 heißt „gehört nicht hinein“; eine auditierte Detail-Route ist keine Zeilenquelle. Beleg: Prettier grün
- [x] 3.5 Hat sich eine abgerufene Zeile während ihres Abrufs geändert (Referenz), setzt der Zeilenabgleich sie nicht ein und legt sie ins nächste Fenster; die übrigen gehen ein (D6). Beleg: Vitest (gleiche Zeile bleibt optimistisch und wird erneut abgerufen, bei Personen und Schäden; andere Zeile bleibt, die abgerufene geht ein, kein Listenabruf)

## 4. Abschluss

- [ ] 4.1 Integration: `./scripts/check-all.sh` grün (in der Cloud-Sitzung mindestens Bündel `schnell`, Vitest gesamt mit `TZ=Europe/Berlin` und die betroffenen Rust-Test-Binaries samt `--lib`; das volle `rust`- und `e2e`-Bündel trägt die CI)

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (`dev-zunder-ausfuehren`, „Review vor dem PR“); nach den Behebungen ein Reviewer über die Behebungs-Commits.
- `/opsx:archive l3vfnpdz-personen-zeilenabgleich` im selben Branch, dann PR gegen `alpha`.
