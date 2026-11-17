# Tasks

Jede Aufgabe per `superpowers:test-driven-development`: erst den roten Test, dann der Code.

## 1. Fixture und Browser-Regel

- [x] 1.1 Abschnitt `ausfall` in `tests/fixtures/verdichtung/regeln.json` anlegen, mit den Fällen aus design.md D3 und der erwarteten Namensliste in Folge. Prüfen: Die Datei ist gültiges JSON (`python3 -m json.tool`).
- [x] 1.2 In `frontend/src/lage/ausfallJeEinheit.ts` `einheitenMitAusfall(rohdaten)` ergänzen: Einheiten mit Mittel- oder Material-Ausfall nach `sortier`, `id`, „Ohne Einheit“ zuletzt, als `{ id, name }`. Den Fall im Fixture-Test `lage/verdichtungFixture.test.ts` ergänzen. Prüfen: Vitest ist erst rot (Funktion fehlt), dann grün.
- [x] 1.3 `useWasBrennt` liest die Liste aus `einheitenMitAusfall` statt der eigenen Abbildung. Prüfen: `useWasBrennt.test.tsx` mit einem Fall, in dem `sortier` von der Baumfolge abweicht, ist grün.

## 2. Server-Regel

- [x] 2.1 `MaterialStatus::ist_ausfall()` und eine Funktion für „aufgebraucht“ in `src/material/` anlegen. Prüfen: Unit-Test über alle fünf Status und den Fall „aufgebraucht“ ist grün.
- [x] 2.2 Reinen Kern `einheiten_mit_ausfall` in `src/einsatz/ausfall.rs` nach design.md D1 und D4 bauen und im Fixture-Test `tests/verdichtung_fixture.rs` gegen den Abschnitt `ausfall` prüfen. Prüfen: `cargo test --test verdichtung_fixture` ist erst rot, dann grün.
- [x] 2.3 Lader `load_einheiten_mit_ausfall(pool, einsatz_id)` (Einheiten über `einheit::repo::liste`, schmale Abfragen für Personal, Fahrzeuge und Material, ohne Personennamen) samt Repo-Test mit echter DB: aufgelöste Einheit, beendetes Fahrzeug mit Beladung, Material an UHS, Handstatus „nicht verfügbar“. Prüfen: `cargo test einsatz::ausfall` ist grün.

## 3. Lagemonitor

- [ ] 3.1 `LagemonitorAlarm` um `ausfall: Vec<String>` erweitern, im Handler `alarm` füllen und die Routen-Tests in `src/routes/lagemonitor.rs` ergänzen: Ausfall mit Einheitsname, und der Name einer Person steht nicht in der Antwort. Prüfen: `cargo test routes::lagemonitor` ist grün.
- [ ] 3.2 `scripts/check-typ-codegen.sh` laufen lassen und beide generierten Dateien mitcommitten. Prüfen: Das Skript endet mit 0.
- [ ] 3.3 `alarmAusMonitor` liefert `ausfall` als Quelle (`id: null`); fehlt das Feld, bleibt `null`. Prüfen: `alarmAusMonitor.test.ts` mit dem Fall „Ausfall: Sanitätszug, Logistiktrupp +1“ wie im Browser und einem Fall ohne Feld ist grün.

## 4. Doku und Regeln

- [ ] 4.1 `frontend/AGENTS.md`, „Eine Heimat je Zahl“: Server-Zählung `einsatz::ausfall`, Bindung über `regeln.json` (Abschnitt `ausfall`) und Folge der Einheitenliste nennen. Den Kommentar in `src/routes/lagemonitor.rs` und `lage/alarmAusMonitor.ts` („Den Ausfall trägt der Monitor nicht“) berichtigen. Prüfen: `git grep -n "Ausfall trägt der Monitor nicht\|ohne den Ausfall"` trifft nur noch Archiv und ADR-0057.
- [ ] 4.2 Anwenderdoku `docs/anwender/kapitel/lagemonitor.md`, Punkt 1: Der Monitor nennt den Ausfall, die Einheiten in der Folge der Einheitenliste. Prüfen: Die Wächter für die Anwenderdoku sind grün (`check-all.sh`, Bündel `schnell`).
- [ ] 4.3 Neue ADR (nächste freie Nummer auf `alpha`): „Ausfall je Einheit zählen Browser und Server, gebunden über das gemeinsame Fixture“, mit `gilt_fuer` auf `frontend/src/lage/ausfallJeEinheit.ts`, `src/einsatz/ausfall.rs` und `tests/fixtures/verdichtung/regeln.json`, und einer Prüfung mit `verlange` auf Abschnitt und beide Tests. Prüfen: `scripts/check-adr-nummern.sh` und die ADR-Wächter sind grün.

## 5. Gesamtprüfung

- [ ] 5.1 `./scripts/check-all.sh --geaendert --ohne-e2e` ist grün; das Ergebnis kommt in den PR unter „Geprüft“.

## Workflow follow-up

- Review nach Ermessen (Backend und Frontend mit geänderter Schnittstelle: Anlass „Größe“ prüfen).
- `/opsx:archive t31o93c2-ausfall-am-server` im selben Branch vor dem PR.
- Bilder: Lagemonitor mit „Ausfall: …“ in der Alarmzeile, dazu Überblick zum Vergleich.
