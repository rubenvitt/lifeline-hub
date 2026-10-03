# Tasks

## 1. Einstellung in Cargo.toml

- [x] 1.1 In `Cargo.toml` `[profile.dev] debug = "line-tables-only"` und
      `[profile.dev.package."*"] debug = false` mit Kommentar eintragen: Messwerte (D1),
      Begründung und der Weg zu voller Debuginfo für lldb. Verifikation: `cargo build` meldet
      `[unoptimized + debuginfo]`, das `einsatz`-Testbinary ist kalt gebaut ≤ 150 MB.
      Ergebnis 03.10.2026: 141,8 MiB (messprotokoll.txt, E).
- [x] 1.2 Backtrace prüfen: ein Wegwerf-Test mit Panik in `tokio::spawn`, Lauf mit
      `RUST_BACKTRACE=1`. Verifikation: Die eigenen Frames nennen `Datei:Zeile`. Der Test wird
      nicht committet. Ergebnis: `tests/…rs:4:6` und `:9:34`, dazu `tokio …/core.rs:380:24`.

## 2. CI auf die eine Quelle umstellen

- [x] 2.1 `CARGO_PROFILE_DEV_DEBUG` aus `ci.yml` und `coverage.yml` streichen, die Kommentare
      auf `Cargo.toml` verweisen lassen (D2). Verifikation: `git grep CARGO_PROFILE_DEV_DEBUG
      .github` ist leer (03.10.2026); die CI des PRs belegt den Rest.
- [x] 2.2 `scripts/AGENTS.md` (Absatz „Jeder Checkout baut in sein eigenes `target/`“): die
      Kostenzahl auf den neuen Messstand bringen und auf diese Change verweisen.
      Verifikation: Die genannten Zahlen stehen in `design.md`.

## 3. Nachweis

- [x] 3.1 Voller Bau mit der eingetragenen Einstellung, ohne `--config`. Verifikation:
      `target` ≈ 21,6 GB wie Variante D im Messprotokoll. Ergebnis: 21 630 MB, 129 Binaries
      mit 15 724 MB, also dieselben Werte wie D.
- [x] 3.2 Gates: `./scripts/check-all.sh --nur=schnell` und `--nur rust` lokal, voll in der CI
      des PRs. Verifikation: Exit 0. Ergebnis 03.10.2026 (Cloud-Sitzung): `schnell` grün
      (Schritte 1–3, 6, 8–13). `rust`: Workspace-Suite grün (129 × `test result: ok`, kein
      Fehlschlag); rot nur `cargo test -p lifeline-desktop`, weil dem Container die
      GTK-Systembibliothek `gdk-3.0` fehlt (wie LFH-688). Den vollen Lauf belegt die CI des PRs.
