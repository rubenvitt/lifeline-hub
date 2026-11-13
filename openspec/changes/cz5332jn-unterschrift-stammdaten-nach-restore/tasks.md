# Tasks

Jede Aufgabe entsteht per TDD: erst der Test rot, dann der Code, dann grün. Die drei
Reproduktionstests `zurueckgespielt_hub_*` liegen schon rot auf dem Branch.

## 1. Unterschriftsschlüssel: Stand folgt der Uhr (D1)

- [x] 1.1 `next_stand` in `src/auth/unterschrift/repo.rs` auf `MAX(MAX(stand) + 1, Unix-Sekunden)` umstellen, mit innerer Fassung, die die Sekunden als Argument nimmt. Unit-Tests in `repo/tests.rs`: Uhr über dem Höchsten → Uhr; Höchster über der Uhr → +1. Prüfen: `cargo test --lib unterschrift::repo`
- [x] 1.2 Tests, die kleine feste Stände der Schlüssel erwarten, auf relative Aussagen umstellen (`src/auth/unterschrift/repo/tests.rs`, `tests/instanz_kopplung.rs`). Prüfen: `cargo test --lib unterschrift` und `cargo test --test instanz_kopplung` grün, bis auf die Tests aus 2 und 3
- [x] 1.3 Prüfen, dass `zurueckgespielt_hub_widerruf_erreicht_den_elw` jetzt grün ist

## 2. Unterschriftsschlüssel: andere id ersetzt den alten (D5)

- [x] 2.1 `accept_lieferungen` liest zur bekannten id `credential_id` und `schluessel`. Weicht einer ab, wird der alte widerrufen (ein abgelehnter bleibt abgelehnt), `fremde_id = -id`, und die Lieferung läuft weiter wie ohne bekannte id. Unit-Tests in `repo/tests.rs`: Ersatz mit gültiger Gegenzeichnung → alter widerrufen, neuer wartet; Ersatz ohne gültige Gegenzeichnung → alter widerrufen, neuer verworfen; abgelehnter alter bleibt abgelehnt; widerrufener Ersatz → alter widerrufen, nichts eingefügt
- [x] 2.2 Prüfen, dass `zurueckgespielt_hub_neuer_schluessel_erreicht_den_elw` grün ist und am ELW B widerrufen und C wartend zeigt (Spec-Szenario „Zurückgespielter Hub vergibt eine Kennung neu“)

## 3. Unterschriftsschlüssel: Netz an der erreichten Seite (D2)

- [x] 3.1 `unterschrift::renew_stand_ueber(conn, org_id, gemeldet)` und eine Abfrage des höchsten lokalen Stands. Unit-Test: gültige und widerrufene Schlüssel bekommen `gemeldet + 1 …` in der alten Reihenfolge, wartende bleiben
- [x] 3.2 In `handle_meldung` (`src/instanz/melden.rs`) je aktiver Org vor `unterschrift::nachlieferung`: gemeldeter Stand über dem Höchsten und höchstens 2³⁹ → neu stempeln und Hinweis an der Kopplung. Integrationstest `zurueckgespielt_hub_mit_nachgehender_uhr_widerruf_erreicht_den_elw` (Stände über der Uhr, Widerruf kommt an, Hinweis steht) und `unplausibler_unterschrift_stand_stempelt_nicht_neu`
- [x] 3.3 Integrationstest `zurueckgespielt_elw_bekommt_den_schluessel_erneut` (Spec-Szenario „ELW zurückgespielt“). Prüfen: `cargo test --test instanz_kopplung` grün

## 4. Stammdaten: Startsprung (D3)

- [x] 4.1 `stammdaten::raise_log_stand(pool, jetzt_s)` in `src/instanz/stammdaten/` (hebt `sqlite_sequence` für `stammdaten_aenderung`, legt die Zeile an, wenn sie fehlt, senkt nie). Unit-Tests: heben, nicht senken, fehlende Zeile, und die nächste Log-Zeile liegt darüber
- [x] 4.2 Aufruf in `run_server` (`src/main.rs`) nach `db::migrate`. Im Reproduktionstest `zurueckgespielt_hub_aenderungen_erreichen_den_elw` den Neustart durch den Aufruf nachstellen; prüfen: grün
- [x] 4.3 Tests, die kleine feste Log-Stände erwarten, auf relative Aussagen umstellen. Prüfen: `cargo test --test instanz_stammdaten --test instanz_stammdaten_kataloge --test instanz_stammdaten_live` und `cargo test --lib instanz::stammdaten`

## 5. Stammdaten: Netz an der erreichten Seite (D4)

- [x] 5.1 `stammdaten::renew_log_der_org(conn, org_id, gemeldet)`: Zähler auf mindestens `gemeldet` heben, Log-Zeilen der Org in Reihenfolge neu einfügen. Unit-Test: alle Zeilen der Org liegen danach über `gemeldet` in alter Reihenfolge, andere Orgs unberührt, ein Trigger-Eintrag danach liegt darüber
- [x] 5.2 In `handle_meldung` je Org vor `liefern::nachlieferung` (nur Stand ≥ 0, nur Kopplungen, die Stammdaten tragen): gemeldeter Stand über dem Höchsten der Org und höchstens 2³⁹ → neu stempeln und Hinweis. Integrationstests `zurueckgespielt_hub_mit_nachgehender_uhr_liefert_die_org_erneut` (ohne Startsprung, Hinweis steht) und `unplausibler_stammdaten_stand_stempelt_nicht_neu`
- [x] 5.3 Integrationstest `zurueckgespielt_elw_bekommt_das_fahrzeug_erneut` (Spec-Szenario „ELW zurückgespielt“). Prüfen: `cargo test --test instanz_stammdaten` grün

## 6. Doku

- [ ] 6.1 `docs/betrieb/backup-restore.md`, Abschnitt „Gekoppelte Instanz zurückspielen“: Unterschriftsschlüssel und Stammdaten, die neuen Hinweise, die Grenzen (Uhr, Reste nach LLH-1871); Anwenderkapitel `docs/anwender/kapitel/instanzkopplung.md` an der Stelle zum Zurückspielen ebenso. Prüfen: in `frontend/` `mise exec -- pnpm exec vitest run src/hilfe/anwenderdoku.guard.test.ts` grün
- [ ] 6.2 Neue ADR „Stände der Schlüssel und des Stammdaten-Logs folgen der Uhr, ein Rückschritt zeigt sich am gemeldeten Stand“ (nächste freie Nummer auf `alpha`) mit Regeln und Prüfung; Kapitel 11 R35 um Schlüssel und Stammdaten ergänzen. Prüfen: `scripts/check-architektur.sh` grün

## 7. Abschluss

- [ ] 7.1 `./scripts/check-all.sh` grün (Lauf oder CI des PRs)

## Workflow follow-up

- Review vor dem PR (`dev-zunder-orchestrieren`, Phase 4), Befunde behandeln.
- `/opsx:archive` im selben Branch, dann PR gegen `alpha`.
