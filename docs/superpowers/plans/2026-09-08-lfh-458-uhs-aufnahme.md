# LFH-458: atomare UHS-Aufnahme

## Umfang und Ablauf

1. Laden/Scope/Design: Ticket und LFH-326-Kontext geprüft. Vorhandene Sichtungs-Transaktion
   und UHS-Eintritt wiederverwenden. Alle lokalen Main-Änderungen auf ausdrücklichen Wunsch
   übernommen; Implementierung sequenziell im Worktree, unabhängiger Review read-only.
2. Entwicklung Backend: `AnlegenBody.uhs_id`, zusätzlicher UHS-Modulzugriff, 422 bei
   `vermisst`. `belegung_repo::eintritt_tx` aus bestehender Logik extrahieren, unter
   `war_neu` mit Audit schreiben, Antwort danach laden, Live-Ereignisse nach Commit.
   Tests: Erfolg mit/ohne Sichtung, Rollback bei Belegungsfehler, Replay, 404 fremd/unbekannt,
   422 inaktiv/vermisst und fehlender Modulzugriff. Risiko: partielle Anlage und Cross-Einsatz-Zugriff.
3. Entwicklung Frontend: UHS-Auftrag im Anlege-Payload, keine Folge-Mutation; Quittung aus
   Antwort, Offline-Vorbehalt entfernen. UHS-Queries auch beim Queue-Drain invalidieren.
   Tests: genau ein Schreibrequest, persistente Queue mit UHS/client_id, Replay-Übertragung,
   Fehler bleibt im Formular, beide Speicherwege ohne Handarbeitsvorbehalt.
4. Prüfliste aktualisieren; Typ-Codegen fahren. Request-DTOs sind derzeit handgeschrieben;
   Response-Schemas ändern sich voraussichtlich nicht. Keine künstlichen Schema-Diffs.
5. Review/Abschluss: unabhängiger Review, Befunde konkret gegenprüfen, relevante Tests und
   vollständiges `scripts/check-all.sh`, `git diff --check`, Board auf belegten Stand setzen.

## Fortschritt

- Laden/Scope/Design und Entwicklung abgeschlossen.
- Basis: `origin/main` bei `ac00098411b458c7d096a688b90dd534025109c0`.
- Alle angeforderten Main-Änderungen übernommen: `CLAUDE.md`, `AGENTS.md`,
  `.codex/config.toml`, `scripts/check-all.sh`, `scripts/build-release.sh`.
- Baseline: 25 Frontend-Tests und fünf bestehende Erst-Sichtungs-Tests grün.
- RED: fünf neue Frontend-Fälle und fünf Backend-Fälle scheitern am bisherigen Verhalten.
- GREEN: 106 Rust-Tests (Personen, UHS, Modulrechte, LFH-458), 28 Frontend-Tests.
- Unabhängige read-only Reviews für Backend und Frontend: keine bestätigten Befunde.
- Ant-Design-CLI 6.6.3: keine Befunde. Shell-Syntax der übernommenen Skripte gültig.
- Typ-Codegen inkl. Driftprüfung und Typecheck grün; generierte Dateien unverändert.
- Erster Gesamtlauf: Format/Lint/Codegen, 2.195 Rust-Tests (fünf bestehende ignoriert),
  3.695 Frontend-Tests in 323 Dateien und Abhängigkeitsprüfung grün. Playwright-Start
  scheiterte am verbliebenen festen `target/debug`-Pfad in seiner Konfiguration.
- Ergänzung zur übernommenen Main-Anpassung: `frontend/playwright.config.ts` ermittelt
  `target_directory` ebenfalls mit `cargo metadata`. Konfigurationsprüfung über
  `playwright test --list`: Exit 0; unabhängiger Review ohne Befund.
- Zweiter vollständiger Lauf `rtk proxy bash scripts/check-all.sh`: **Exit 0**,
  `OK: alle Gates grün.` Formatierung, Lint, Typ-Codegen/Typecheck und Abhängigkeitsprüfung
  grün; **2.195 Rust-Tests bestanden, fünf bestehende Tests ignoriert**;
  **3.695 Vitest-Tests in 323 Dateien** und **117 Playwright-Tests** bestanden.
  Lokales vollständiges Prüflog: `/tmp/lfh-458-check-all-final.log`.
- Finale Diff-Prüfung sauber. Boardstatus `testing`; Implementierung und Review abgeschlossen.
- Integration (Commit/PR/Merge) nur nach entsprechendem Auftrag.
