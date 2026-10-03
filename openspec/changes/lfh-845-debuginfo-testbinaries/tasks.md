# Tasks

## 1. Einstellung in Cargo.toml

- [ ] 1.1 In `Cargo.toml` `[profile.dev] debug = "line-tables-only"` und
      `[profile.dev.package."*"] debug = false` mit Kommentar eintragen: Messwerte (D1),
      Begründung und der Weg zu voller Debuginfo für lldb. Verifikation: `cargo build` meldet
      `[unoptimized + debuginfo]`, das `einsatz`-Testbinary ist kalt gebaut ≤ 150 MB.
- [ ] 1.2 Backtrace prüfen: ein Wegwerf-Test mit Panik in `tokio::spawn`, Lauf mit
      `RUST_BACKTRACE=1`. Verifikation: Die eigenen Frames nennen `Datei:Zeile`. Der Test wird
      nicht committet.

## 2. CI auf die eine Quelle umstellen

- [ ] 2.1 `CARGO_PROFILE_DEV_DEBUG` aus `ci.yml` und `coverage.yml` streichen, die Kommentare
      auf `Cargo.toml` verweisen lassen (D2). Verifikation: `git grep CARGO_PROFILE_DEV_DEBUG
      .github` ist leer, die CI des PRs ist grün.
- [ ] 2.2 `scripts/AGENTS.md` (Absatz „Jeder Checkout baut in sein eigenes `target/`“): die
      Kostenzahl auf den neuen Messstand bringen und auf diese Change verweisen.
      Verifikation: Die genannten Zahlen stehen in `design.md`.

## 3. Nachweis

- [ ] 3.1 Voller Bau mit der eingetragenen Einstellung, ohne `--config`. Verifikation:
      `target` ≈ 21,6 GB wie Variante D im Messprotokoll.
- [ ] 3.2 Gates: `./scripts/check-all.sh --nur=schnell` und `--nur rust` lokal, voll in der CI
      des PRs. Verifikation: Exit 0.
