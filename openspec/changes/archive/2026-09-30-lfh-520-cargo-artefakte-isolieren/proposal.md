# Proposal

## Why

Alle Worktrees bauen über `~/.cargo/config.toml` in dasselbe Cargo-Target
(`~/.cache/cargo-target`). Cargo bildet den Artefakt-Hash der Workspace-Mitglieder aus dem
Pfad **relativ zur Workspace-Wurzel**. Zwei Worktrees desselben Repos teilen sich deshalb
dieselben Fingerprints und Binaries, und die Frische wird über Zeitstempel entschieden. Sind
die Quellen eines Worktrees älter als der letzte Bau eines anderen, meldet Cargo „Fresh“ und
führt fremden Code aus.

Das ist am 30.09.2026 belegt, zuerst an einem Mini-Crate und dann am Projekt selbst. Ein
zweiter Quellstand, dessen Handler `vermisst` + UHS nicht mehr abweist, meldete für
`cargo test --test person_aufnahme_uhs` 6/6 grün. Er hatte das Testbinary des anderen Stands
ausgeführt, ohne selbst zu kompilieren. Das ist derselbe Befund wie im LFH-460-Vollgate.
Grüne Gates beweisen damit nichts über den eigenen Stand. Dasselbe gilt für das Backend-Binary,
das Playwright startet (siehe Memory „fremdes `frontend/dist`“).

## What Changes

- Das Repo bringt eine eigene Cargo-Konfiguration mit, die das Build-Ziel **je Checkout** auf
  `<worktree>/target` legt. Sie hat Vorrang vor der globalen Nutzerkonfiguration. Ein explizit
  gesetztes `CARGO_TARGET_DIR` schlägt beide, wie bisher.
- Das Sammel-Gate prüft vor den Schritten, die Cargo-Artefakte verwenden (Typ-Drift, Rust-Suite, e2e),
  dass das Build-Ziel dem eigenen Checkout gehört. Andernfalls bricht es mit Erklärung ab.
  Eine ausdrückliche Übersteuerung per Umgebungsvariable bleibt erlaubt und wird angezeigt.
- Sammel-Gate und alleinstehendes Playwright nennen das verwendete Backend-Binary mit Pfad.
- Die Regel samt Herleitung kommt in `CLAUDE.md` (Qualitäts-Gates). Überholte
  Arbeitsanweisungen („`CARGO_TARGET_DIR` ins Scratchpad“) werden ersetzt.
- **Nicht** Teil der Änderung: die globale `~/.cargo/config.toml` des Nutzers. Ihr Kommentar
  („verschiedene Projekte … stören sich nicht“) stimmt für Worktrees desselben Repos nicht.
  Eine Korrektur wird vorgeschlagen, aber nicht ausgeführt.

## Capabilities

### New Capabilities
- `worktree-bauziel`: Jeder Checkout baut und prüft ausschließlich seinen eigenen Quellstand.
  Das umfasst das Build-Ziel je Checkout, die Übersteuerung, die Prüfung im Sammel-Gate und
  die nachvollziehbare Binary-Zuordnung für Playwright.

### Modified Capabilities
<!-- keine -->

## Impact

- Neu: `.cargo/config.toml` (neben der bestehenden `.cargo/audit.toml`).
- `scripts/check-all.sh` (Schritt 4 und 7), neue Prüffunktion unter `scripts/lib/`, dazu ein
  Selbsttest im `schnell`-Bündel. `frontend/playwright.config.ts` bekommt nur eine
  Ausgabezeile.
- CI: keine Verhaltensänderung. Dort ist `target` schon heute das Ziel, rust-cache und
  `ci.yml:182` bleiben unverändert.
- **Plattenplatz lokal:** Jeder Worktree mit vollem Testbau belegt eigene ~19 GB (gemessen).
  Bisher überschrieben sich alle gegenseitig in einem Verzeichnis. Freigegeben wird der Platz
  mit dem Entfernen des Worktrees. Die Platte steht bei 94 %; die Abwägung steht in
  `design.md` D2.
- Übergang: Ältere Worktrees ohne die Datei, die unter einem Main-Checkout **mit** der Datei
  liegen, erben dessen Konfiguration und teilen sich `<main>/target`. Das ist derselbe Fehler
  wie heute, nur an einem anderen Ort. Er endet, sobald der Worktree auf `alpha` vorgezogen ist.
