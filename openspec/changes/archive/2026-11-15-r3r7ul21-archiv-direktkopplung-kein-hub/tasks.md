# Tasks

## 1. Sperre ohne Direktkopplung

- [x] 1.1 Unit-Test `eine_direktkopplung_vor_ort_macht_keinen_hub` in `src/instanz/repo.rs`: eine angebahnte und eine aktive `wird_gemeldet`-Kopplung der Art `vor_ort` sperren nicht, eine `standard` daneben sperrt weiter; der Test ist vor der Änderung rot (`cargo test --lib instanz::repo::tests`)
- [x] 1.2 `wird_erreicht` um `art <> 'vor_ort'` ergänzen, Doc-Kommentar nachziehen; 1.1 wird grün
- [x] 1.3 Integrationstest in `tests/archiv_einspielen.rs`: an einer Instanz, die einem anderen ELW einen Code für die Direktkopplung vor Ort ausgestellt hat (Kopplung angebahnt und aktiv), meldet `GET /api/admin/archiv/einspielen` `verfuegbar: true` und das Hochladen spielt ein; mit zusätzlicher Standardkopplung `wird_gemeldet` bleibt es 422 (`cargo test --test archiv_einspielen`)
- [x] 1.4 Text der Ablehnung in `src/routes/archiv_einspielen.rs` nennt die Ausnahme (design.md D3); vorhandene Tests auf den Text prüfen und grün halten

## 2. Regel und Doku

- [x] 2.1 ADR-0051 ersetzt ADR-0045 (akzeptierte ADRs sind unveränderlich, `docs/architektur/AGENTS.md`): alle Regeln übernommen, eine Regel nennt die Ausnahme, Prüfung verlangt `art <> 'vor_ort'` in `src/instanz/repo.rs`; ADR-0045 auf `ersetzt`; `scripts/adr-fuer.sh src/instanz/repo.rs` zeigt die neue Regel, die Prüfung des ADR-Wächters ist grün
- [x] 2.2 `docs/anwender/kapitel/aufbewahrung.md` („Ein Archiv einspielen“, „Nicht am Hub“, „Wer was darf“) und `docs/betrieb/backup-restore.md` („Nicht an einem Hub“) nennen die Ausnahme; die Doku-Wächter in `check-all.sh` sind grün

## 3. Abschluss

- [x] 3.1 `./scripts/check-all.sh --geaendert` grün (bzw. die Bündel der berührten Bereiche) — lokal grün (nach Merge von alpha): Bündel `schnell`; Rust-Suite wie Schritt 4, wegen der Platte der Cloud-Sitzung in Paketen zu je 20 Testzielen (`--lib --bins` 4417, alle 257 Integrationsziele 3807, übrige Workspace-Crates 80); `lifeline-desktop` baut in der Sitzung nicht (GTK-Systembibliotheken fehlen, `src-tauri/` unberührt); Frontend: die vier Vitest-Dateien, die `docs/anwender/` lesen (30). Kein Label `voll` (ADR-0050)

## Workflow follow-up

- Review vor dem PR, dann `/opsx:archive` im selben Branch, dann PR gegen `alpha`.
