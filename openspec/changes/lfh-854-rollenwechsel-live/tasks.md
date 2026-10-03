# Tasks

Jede Aufgabe per `superpowers:test-driven-development` (erst rot, dann grün). Rust über
`cargo test` mit eigenem `CARGO_TARGET_DIR`, e2e über die Suite in `frontend/e2e/`. Vor „fertig"
`verification-before-completion` und `requesting-code-review`.

## 1. Emitter (D1, D3, D4)

- [ ] 1.1 `tests/einsatz_live.rs` zuerst: PUT Mitgliedschaft (neues Mitglied als Beobachter, dann Wechsel auf Führungspersonal) → je genau ein `einsatz` mit Nutzlast `{"einsatz_id":…}` und genau ein `einsatzliste`; DELETE Mitgliedschaft → genau ein `einsatz`. Rot belegen.
- [ ] 1.2 `src/routes/einsatz.rs`: `kopf_geaendert_fuer(state, id, betroffene)` einführen, `kopf_geaendert` ruft sie mit `&[]`; `mitglied_setzen`/`mitglied_entfernen` rufen sie mit `&[ziel_id]` statt `einsatzliste_melden`. Doc-Kommentare auf LFH-854 fortschreiben. Tests aus 1.1 grün.
- [ ] 1.3 Abwesenheitstests in `tests/einsatz_live.rs`: Herabstufen und Entfernen der letzten Einsatzleitung (409), unbekannter Benutzer (404), PUT durch ein Mitglied ohne Leitungsrecht (403) → kein `einsatz`. Grün; Mutationsprobe: Emitter vor die 409-Prüfung gezogen → rot, zurückgedreht → grün.
- [ ] 1.4 Kommentar am Testkopf von `tests/einsatz_live.rs` und an `LiveEvent::Einsatz` in `src/live/mod.rs` um den Mitgliedschaftsweg und die Leck-Abwägung (D2: Mitgliederliste hinter derselben Tür) ergänzen; `cargo test --lib live` grün.

## 2. Nachweis Ende zu Ende

- [ ] 2.1 `frontend/e2e/einsatzkopf-live.spec.ts`: Admin legt Einsatz und Beobachter-Konto an (Helfer aus `rollen-kern.ts`), Beobachter öffnet in einem eigenen Kontext eine Modulseite mit Primäraktion und wartet auf den Strom; Primäraktion nicht da/gesperrt. Admin setzt ihn per API auf Führungspersonal → Primäraktion ohne Neuladen frei; zurück auf Beobachter → wieder gesperrt.
- [ ] 2.2 Mutationsprobe: Emitter in `mitglied_setzen` entfernt → 2.1 rot; zurückgedreht → grün. Befund in `design.md` unter „Nachweise" festhalten.

## 3. Integration

- [ ] 3.1 `./scripts/check-all.sh` (eigenes `CARGO_TARGET_DIR`) grün, Log nach „ÜBERSPRUNGEN" durchsehen. Belegt durch die CI des PR (`ci.yml` ruft `check-all.sh`).
- [ ] 3.2 `/opsx:archive lfh-854-rollenwechsel-live` im selben Branch vor dem PR; den MODIFIED-Block „Bewusst nicht live" gegen den Stand von `alpha` prüfen (LFH-855 ändert dieselbe Anforderung).
