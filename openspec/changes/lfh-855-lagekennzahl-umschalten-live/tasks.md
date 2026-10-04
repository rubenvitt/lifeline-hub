# Tasks

## 1. Auslöser lesen

- [x] 1.1 `einsatz::lagekennzahl::lesen(conn, einsatz_id)` mit den beiden `EXISTS`-Ausdrücken über `ableiten`; Doku an `ableiten` auf drei Stellen fortschreiben. Beleg: Unit-Test in `lagekennzahl.rs` (leer, Pegel, aktiver Bezirk, stornierter und aufgehobener Bezirk zählen nicht) grün.

## 2. Pegel

- [x] 2.1 Rot zuerst in `tests/einsatz_live.rs`: erster Pegel per POST feuert `einsatz` (genau 1); zweiter Pegel per POST und Umordnen per PUT feuern keins; PUT mit leerer Liste feuert `einsatz`; erster Pegel per PUT feuert `einsatz`. Beleg: Tests rot vor 2.2.
- [x] 2.2 `pegel::repo::ersetzen`/`anfuegen` geben `umgeschaltet` zurück (D2), die Routen rufen danach `kopf_geaendert`; Modulkopf „Kein Live-Ereignis“ in `routes/pegel.rs` fortschreiben. Beleg: Tests aus 2.1 grün, `tests/pegel.rs` grün.

## 3. Evakuierungsbezirke

- [x] 3.1 Rot zuerst in `tests/einsatz_live.rs`: erster Bezirk feuert `einsatz` neben `betreuung`; zweiter Bezirk und eine Änderung ohne Räumungswechsel über `aufgehoben` feuern keins; Räumung des letzten aktiven Bezirks auf `aufgehoben` feuert `einsatz`; Stornieren des letzten aktiven Bezirks feuert `einsatz`. Beleg: Tests rot vor 3.2.
- [x] 3.2 `bezirk_anlegen`, `bezirk_aendern`, `bezirk_stornieren` lesen `lesen` vor und nach dem `_tx`-Aufruf im selben `write_retry!` und rufen bei Umschalten `kopf_geaendert`. Beleg: Tests aus 3.1 grün, `tests/betreuung.rs` grün.
- [x] 3.3 Mutationsprobe: Vergleich in einer Route auf `true` gezwungen → Abwesenheitstests rot; Emitter entfernt → Umschalttests rot; zurückgedreht → grün. Beleg: Ergebnis in `design.md` unter „Nachweise“.

## 4. Frontend und Doku

- [x] 4.1 Kommentare nachziehen: `frontend/src/api/queryKeys.ts` (Eintrag `einsatz`), `frontend/src/pages/BetreuungPage.tsx` (`invalidiereBezirk`). Beleg: Prettier und `tsc` grün.
- [x] 4.2 e2e-Fall in `frontend/e2e/einsatzkopf-live.spec.ts`: Lage-Dashboard mit offenem Strom, Pegel per API festgelegt → Sammelbanner „Pegel statt Verbleib offen“ erscheint ohne Neuladen, Platz 1 bleibt bis „übernehmen“. Beleg: Fall grün; Mutationsprobe (Emitter aus 2.2 entfernt) rot.

## 5. Abschluss

- [ ] 5.1 `./scripts/check-all.sh` sowie Vitest und Rust-Tests grün (CI-Lauf des PRs belegt den Rest).
- [ ] 5.2 `/opsx:archive` im selben Branch, Spec `einsatzkopf-live` synchronisiert, Verweise nachgezogen.
