# Tasks

## 1. Sperre ohne Direktkopplung

- [ ] 1.1 Unit-Test in `src/instanz/repo.rs` erweitern: eine angebahnte und eine aktive `wird_gemeldet`-Kopplung der Art `vor_ort` sperren nicht, eine `standard` daneben sperrt weiter; der Test ist vor der Änderung rot (`cargo test --lib instanz::repo::tests::erreicht`)
- [ ] 1.2 `wird_erreicht` um `art <> 'vor_ort'` ergänzen, Doc-Kommentar nachziehen; 1.1 wird grün
- [ ] 1.3 Integrationstest in `tests/archiv_einspielen.rs`: an einer Instanz, die einem anderen ELW einen Code für die Direktkopplung vor Ort ausgestellt hat (Kopplung angebahnt und aktiv), meldet `GET /api/admin/archiv/einspielen` `verfuegbar: true` und das Hochladen spielt ein; mit zusätzlicher Standardkopplung `wird_gemeldet` bleibt es 422 (`cargo test --test archiv_einspielen`)
- [ ] 1.4 Text der Ablehnung in `src/routes/archiv_einspielen.rs` nennt die Ausnahme (design.md D3); vorhandene Tests auf den Text prüfen und grün halten

## 2. Regel und Doku

- [ ] 2.1 ADR-0045: Regel nennt die Ausnahme, Prüfung verlangt `art <> 'vor_ort'` in `src/instanz/repo.rs`; `scripts/adr-fuer.sh src/instanz/repo.rs` zeigt die neue Regel, die Prüfung des ADR-Wächters ist grün
- [ ] 2.2 `docs/anwender/kapitel/aufbewahrung.md` („Ein Archiv einspielen“) und `docs/betrieb/backup-restore.md` („Nicht an einem Hub“) nennen die Ausnahme; die Doku-Wächter in `check-all.sh` sind grün

## 3. Abschluss

- [ ] 3.1 `./scripts/check-all.sh --geaendert` grün (bzw. die Bündel der berührten Bereiche)

## Workflow follow-up

- Review vor dem PR, dann `/opsx:archive` im selben Branch, dann PR gegen `alpha`.
