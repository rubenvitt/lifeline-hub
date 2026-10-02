# Tasks

## 1. Org-Prüfung am Frist-PUT (Backend)

- [x] 1.1 Test `frist_put_nur_fuer_den_admin_der_eigenen_org` in `tests/aufbewahrung.rs`: der Admin einer fremden Org bekommt am aktiven und am abgelaufenen, nicht vorgemerkten Einsatz 403, Frist und ETB-Anzahl bleiben unverändert; der Admin der eigenen Org verlegt die abgelaufene Frist danach mit 200 in die Zukunft. Zuerst rot sehen (vor dem Fix 200 statt 403), dann grün
- [x] 1.2 `aufbewahrungsfrist_setzen` (`src/routes/einsatz.rs`): Admin nur bei `benutzer.org_id == einsatz.org_id`, sonst `fordere_einsatzleitung`; Doc-Kommentar nennt den Admin der Einsatz-Org und verweist auf `fordere_archivzugriff`. Verifikation: 1.1 grün, `cargo test --test aufbewahrung --test einsatz --test einsatz_kontext_guard` grün; Mutationsprobe (Org-Vergleich entfernen bzw. `&&` → `||`) macht 1.1 rot
- [x] 1.3 `src/AGENTS.md`, Abschnitt „Backend — Aufbewahrung (LFH-23)“: den Satz „`PUT …/aufbewahrungsfrist` prüft die Org nicht (bekannte Inkonsistenz)“ durch die Regel ersetzen (Admin nur der Einsatz-Org, fremd 403; nach Fristablauf kein Weg für die Einsatzleitung, Verweis auf diese Change). Verifikation: `grep -n "Inkonsistenz" src/AGENTS.md` leer

## 2. `org_id` in `BenutzerAnzeige` (Backend, Typ-Codegen)

- [x] 2.1 Test (in `tests/` neben den bestehenden `GET /api/auth/me`- bzw. Benutzerlisten-Tests): `org_id` steht in der Antwort von `/api/auth/me` und in `GET /api/benutzer`. Zuerst rot sehen
- [x] 2.2 `BenutzerAnzeige` bekommt `org_id: i64`, `Benutzer::anzeige` füllt es, jeder `query_as::<_, BenutzerAnzeige>` in `src/routes/benutzer.rs` selektiert `org_id`. Verifikation: 2.1 grün, Tests der Benutzerverwaltung grün
- [x] 2.3 `scripts/check-typ-codegen.sh` laufen lassen, `frontend/src/api/openapi.json` und `types.generated.ts` mitcommitten; Frontend-Fixtures mit `BenutzerAnzeige` (`src/test/fixtures.ts` u. a.) um `org_id` ergänzen. Verifikation: Skript grün, `tsc` grün

## 3. Client-Spiegel (Frontend)

- [x] 3.1 `fristModell.test.ts`: Fälle „Admin der Einsatz-Org darf, auch ohne Mitgliedschaft“ und „Admin einer fremden Org ohne Mitgliedschaft darf nicht“ (Einsatzleitung einer fremden Org darf weiter). Zuerst rot sehen
- [x] 3.2 `darfFristSetzen` vergleicht `benutzer.org_id` mit `einsatz.org_id` (eigene Typen `FristEinsatzKontext`/`FristBenutzerKontext` in `fristModell.ts` statt die geteilten `…Schreibkontext`-Typen zu erweitern, die viele andere Aufrufer haben; `FristEinsatz` im Paneel um `org_id`; Paneel-Test „Admin einer fremden Org“); `FRIST_RECHTE_TEXT` im `FristPaneel` nennt den System-Admin der Organisation. Verifikation: 3.1 grün, `FristPaneel.test.tsx` grün, `pnpm lint` und `tsc` grün

## 4. Abschluss

- [x] 4.1 `cargo test` (Backend), Frontend-Tests und `./scripts/check-all.sh` grün (bzw. mit Verweis auf den CI-Lauf des PRs abhaken, falls lokal Werkzeuge fehlen) — `cargo test --workspace --exclude lifeline-desktop` lokal grün (119 Testbinaries, 3805 Tests, 0 Fehlschläge), `cargo fmt --check` grün; Frontend `vitest run`: 8871 grün, 10 rot in 5 fremden Dateien (Zeitzone/Node 22 statt 26), identisch auf `origin/alpha`; `typecheck`, `lint`, `prettier --check` grün; `check-all.sh` belegt der CI-Lauf des PRs (lokal fehlt `mise`)
