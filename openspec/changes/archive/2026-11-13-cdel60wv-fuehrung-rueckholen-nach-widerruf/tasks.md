# Tasks

## 1. Backend: Erkennen und Vollziehen (TDD)

- [x] 1.1 SQL-Ausdruck „Führung beendet“ (design.md D2) als Makro in `src/instanz/fuehrung/repo.rs` und `repo::find_fuehrung_beendet` (Org-Schlüssel, `widerrufen_at` der Zuordnung des Spiegels; nach dem Review an `einsatz_spiegel.kopplung_org_id` gebunden, `richte_aus` lässt sie stehen). Prüfen mit Unit-Tests in `repo.rs`: Widerruf ohne Schalter liefert die beendete Führung mit dem Widerrufszeitpunkt; geltende Zuordnung, nur vor Ort, nie gekoppelt, eigene Führung und ein Spiegel über einen Hub liefern `None`; es zählt die Zuordnung des Spiegels.
- [x] 1.2 Gemeinsame Funktion `repo::zurueckholen` (D3) herauslösen; `release_nach_widerruf` nutzt sie. Prüfen: alle bestehenden Tests unter `fuehrung::repo` und `tests/instanz_fuehrung.rs` bleiben grün (`cargo test fuehrung`).
- [x] 1.3 `dienst::zurueckholen(pool, akte_id, grund, wer)`: Grund Pflicht, Erklärung durch `erklaerung_text`, 409 ohne beendete Führung („Die führende Instanz ist noch gekoppelt.“ bzw. „Dieser Spiegel kam nicht über die beendete Kopplung zur führenden Instanz.“), Bruchstelle = Widerruf, Verlauf mit Grund und Bediener. Prüfen mit Unit-Tests in `dienst.rs`: nach Widerruf ohne Schalter und Einschalten führt die Instanz mit nächster Epoche, der Spiegel ist weg (`einsatz_spiegel` leer), Erklärung nennt die alte Führung ohne Beweis; ohne Grund 422; zu langer Grund 422 ohne Änderung; geltende Zuordnung 409; ohne Handlung bleibt die Akte nach `save_schalter(true)` unverändert.
- [x] 1.4 Anzeige: `FuehrungAnzeige.fuehrer_beendet_at` und `EinsatzFuehrung.beendet` (Kopf über `fuehrung_spalten!`, `FuehrungSpalten`). Prüfen mit Tests: Feld gesetzt genau in der Lage aus 1.1, im Kopf von `GET /api/einsaetze/{id}` sichtbar; `scripts/check-typ-codegen.sh` grün, beide generierten Dateien mitcommittet.

## 2. Backend: Route und Rechte

- [x] 2.1 Route `POST /api/einsaetze/{id}/fuehrung/zurueckholen` in `src/routes/fuehrung.rs` und `src/app.rs` (Gate `EinsatzFuehrungszugriff`, 404 ohne Schalter), Admin-Spur `FuehrungNotuebernahme` mit „Führung zurückgeholt von X (Kopplung beendet): <Grund>“, Live-Meldung über `danach`. Prüfen mit Integrationstests in `tests/instanz_fuehrung.rs`: Einsatzleitung und Org-Admin holen zurück (200, Einsatz danach schreibbar), Führungspersonal 403, ohne Grund 422, geltende Zuordnung 409, Admin-Spur trägt den Text; `tests/einsatz_kontext_guard.rs` grün.
- [x] 2.2 Dritte meldende Seite: Integrationstest, dass eine am Hub zurückgeholte Akte (alte Führung „ELW 1“) bei „ELW 2“ ohne Alarm und ohne Admin-Spur ankommt (Muster wie der bestehende Test zum Widerruf mit Schalter). Prüfen: `cargo test --test instanz_fuehrung`.

## 3. Frontend

- [x] 3.1 `frontend/src/api/fuehrung.ts`: `holeFuehrungZurueck(einsatzId, grund)`; `fuehrungText.ts`: `fuehrungMoeglich().zurueckholen` und Text „Kopplung zu X beendet“. Prüfen mit Tests in `fuehrungText.test.ts` (gesetzt nur mit `fuehrer_beendet_at`, nicht führend, Einsatz hier; Anfrage und Notübernahme dann nicht).
- [x] 3.2 `FuehrungPaneel.tsx`: Hinweis „Kopplung zu X beendet seit …“ und „Führung zurückholen …“ mit Grund-Dialog. Prüfen mit Tests in `FuehrungPaneel.test.tsx` (Knopf nur in der Lage, sendet den Grund, ohne `darfBedienen` gesperrt).
- [x] 3.3 `SpiegelBand.tsx`/`spiegelText.ts`: bei `einsatz.fuehrung.beendet` „Kopplung zu X beendet“ statt „Abgleich beendet“ und, wer die Führung bedient, Link „Führung zurückholen“ zur Seite Einsatzdaten. Prüfen mit Tests in `SpiegelBand.test.tsx`; `mise exec -- pnpm -C frontend lint` und `tsc` grün.

## 4. Doku und Verweise

- [x] 4.1 Anwenderkapitel `docs/anwender/kapitel/instanzkopplung.md`, Abschnitt „Widerruf“: Absatz „Ist die Führung je Einsatz ausgeschaltet …“ auf das Zurückholen umschreiben (wer, wo, Grund, Bruchstelle, ersetzt keine Kopplung). Prüfen: Doku-Wächter in `check-all.sh` grün.
- [x] 4.2 ADR-0041 „Einen Spiegel ohne gekoppelte Führung holt nur ein Mensch zurück“ nach `docs/architektur/entscheidungen/VORLAGE.md`; Verweis „Ausweg: LLH-1850“ in `src/instanz/fuehrung/repo.rs` auf die neue Bedienung nachziehen; `src/AGENTS.md`, Instanzkopplung, prüfen, ob ein Satz zu LLH-1704 nachzuziehen ist. Prüfen: `scripts/check-adr-nummern.sh` und `scripts/adr-fuer.sh src/instanz/fuehrung/dienst.rs` nennen ADR-0041.

## 5. Verifikation

- [x] 5.1 `./scripts/check-all.sh --geaendert` grün (ohne `| tail`); Bilder des Paneels und des Hinweisbands in der Lage per Wegwerf-Spec aufgenommen. Lokal (13.11.2026): Schritte 1–3 (rustfmt, Lint, Typ-Drift samt Typecheck) grün, dazu alle Lib-Tests und die berührten Suiten (instanz_*, einsatz_kontext*, enum_wire_kontrakt, openapi_spec_aktuell) und die volle Vitest-Suite; die volle Rust-Suite und e2e passten nicht ins Plattenkontingent der Cloud-Sitzung und belegt die CI dieses PRs.

## Workflow follow-up

- Review vor dem PR (Phase 4), dann `/opsx:archive cdel60wv-fuehrung-rueckholen-nach-widerruf` im selben Branch, dann PR gegen `alpha`.
