# Tasks

## 1. Abfrage und Wächter

- [ ] 1.1 Repo-Test in `src/public_api/zugang.rs` schreiben (nur `vor_ort` → `None`, nur `standard` → Hub, beide → Hub) und rot sehen: `cargo test --lib public_api::zugang`
- [ ] 1.2 `hub_fuer_org` auf `k.art = 'standard'` einschränken, Doc-Kommentar nachziehen; 1.1 grün
- [ ] 1.3 Eintrag `src/public_api/zugang.rs` / `k.art = 'standard'` im Wächter `instanz::art_tests::jeder_fluss_hat_seine_pruefstellen`; Probe: Filter kurz entfernen → Wächter rot, zurück → grün

## 2. Maschinenzugang und Einwurf über die Routen

- [ ] 2.1 `tests/maschinenzugang.rs`: Kopplungs-Insert mit Art als Parameter; neuer Test „nur vor Ort gekoppelt“ (Anfrage 200, Liste ohne `gesperrt_grund`, Anlegen erfolgreich); bestehende Hub-Tests bleiben grün: `cargo test --test maschinenzugang`
- [ ] 2.2 `tests/einwurf.rs`: `org_koppeln` mit Art; neuer Test „nur vor Ort gekoppelt“ (Einwurf angenommen, Paneel ohne Sperrgrund, Anlegen und Schlüsselwechsel möglich); `gekoppelter_elw_nimmt_keine_einwuerfe_an` bleibt grün: `cargo test --test einwurf`
- [ ] 2.3 Mutationsprobe: ohne den Filter aus 1.2 werden 2.1 und 2.2 rot

## 3. Doku

- [ ] 3.1 `docs/anwender/kapitel/anbindungen.md`, Abschnitt „Am ELW“: Satz zur Direktkopplung vor Ort; Wächter der Anwenderdoku grün (`docs/anwender/AGENTS.md`)

## 4. Integration

- [ ] 4.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün

## Workflow follow-up

- Review vor dem PR (Prüfliste), Befunde gegenprüfen.
- `/opsx:archive v5gg1dox-vor-ort-sperrt-keine-anbindungen` im selben Branch, dann PR gegen `alpha`.
