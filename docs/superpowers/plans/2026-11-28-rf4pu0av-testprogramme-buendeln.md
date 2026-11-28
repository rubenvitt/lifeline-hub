# Plan: Integrationstests in Bündeln (LLH-2150)

Entwurf: `docs/superpowers/specs/2026-11-28-rf4pu0av-testprogramme-buendeln-design.md`.
Ausführung: `executing-plans` im Main-Loop. Die Aufgaben hängen aneinander und sind
überwiegend mechanisch.

- [ ] 1. Vorher messen: 12 eigenständige Programme bauen, laufen lassen, Größe notieren.
- [ ] 2. Zuordnung Datei → Bündel als einmaliges Skript (Scratchpad). Es schreibt
      `tests/buendel_*/main.rs`, stellt `mod common;` auf `use crate::common;` um (ebenso
      `instanz_hilfen` und `adapter_testart`) und erzeugt den `[[test]]`-Block.
- [ ] 3. `Cargo.toml`: `autotests = false` setzen und 30 `[[test]]` eintragen.
- [ ] 4. Wächter `tests/testprogramme_guard.rs` schreiben, Mutationsproben: (a) Datei fehlt,
      (b) Setzer in einer gebündelten Datei, (c) umbenannter Setzer.
- [ ] 5. Alles bauen: Größe, Bauzeit, Spitzenspeicher je Bündel. Bündel über ~6 GB teilen.
- [ ] 6. Rust-Suite lokal voll laufen lassen; Testzahl vorher (302 Programme) gegen nachher
      vergleichen.
- [ ] 7. Kommentare und Regeln: `src/AGENTS.md`, `check-all.sh`, `suiten.yml` (Aufräumschritt
      raus), Kopfkommentare der `*_scan`-Dateien.
- [ ] 8. `./scripts/check-all.sh --geaendert --ohne-e2e`, PR gegen `alpha` mit Label `voll`,
      Messwerte an Ticket und PR.
