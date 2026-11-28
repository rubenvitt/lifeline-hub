# Plan: Integrationstests in Bündeln (LLH-2150)

Entwurf: `docs/superpowers/specs/2026-11-28-rf4pu0av-testprogramme-buendeln-design.md`.
Ausführung: `executing-plans` im Main-Loop. Die Aufgaben hängen aneinander und sind
überwiegend mechanisch.

- [x] 1. Vorher messen: 12 eigenständige Programme bauen, laufen lassen, Größe notieren.
- [x] 2. Zuordnung Datei → Bündel als einmaliges Skript (Scratchpad). Es schreibt
      `tests/buendel_*/main.rs`, stellt `mod common;` auf `use crate::common;` um (ebenso
      `instanz_hilfen` und `adapter_testart`) und erzeugt den `[[test]]`-Block.
- [x] 3. `Cargo.toml`: `autotests = false` setzen und alle 42 `[[test]]` eintragen.
- [x] 4. Wächter `tests/testprogramme_guard.rs` schreiben, Mutationsproben: (a) Datei fehlt,
      (b) Setzer in einer gebündelten Datei, (c) umbenannter Setzer.
- [x] 5. Alles bauen: Größe, Bauzeit, Spitzenspeicher je Bündel. Bündel über ~6 GB teilen.
- [x] 6. Rust-Suite lokal voll laufen lassen; Testzahl vorher (302 Programme) gegen nachher
      vergleichen.
- [x] 7. Kommentare und Regeln: `src/AGENTS.md`, `check-all.sh`, `suiten.yml` (Aufräumschritt
      raus), Kopfkommentare der `*_scan`-Dateien.
- [x] 8. `./scripts/check-all.sh --geaendert --ohne-e2e`, PR gegen `alpha` mit Label `voll`,
      Messwerte an Ticket und PR.

Ergebnis (28.11.2026): 42 Programme (9 Bündel, 33 eigenständig), 11,3 GB statt ~87 GB. Das
geplante Bündel `kopplung` ist entfallen; die Begründung steht im Entwurf unter „Echte Verbindungen
von 127.0.0.1“. Gate-Lauf: Rust grün (10.087 Tests). Rot sind zwei Befunde ohne Bezug zu dieser
Änderung: vier Frontend-Dateien, deren Stand byte-gleich mit `alpha` ist, und `ci-stufen`, das
`grep -P` braucht, was macOS nicht kennt.
