# Proposal

## Why

Das Sammel-Gate baut und testet das Backend nur mit den Standard-Features. `dev-seeds` steht
nicht im `default` von `Cargo.toml`, deshalb sieht das Gate weder `src/dev/` noch
`tests/dev_present.rs` noch den Block in `src/main.rs`, der nur mit dem Feature existiert.
Ein Bruch im Dev-Seed, etwa nach einer Signaturänderung an `einsatz::repo::anlegen` oder
`etb::repo::anlegen`, fällt erst beim nächsten `cargo run --features dev-seeds` auf, also bei
dem Menschen, der gerade etwas anderes ausprobieren wollte (gefunden bei LFH-736).

## What Changes

- Neuer Schritt 15 in `scripts/check-all.sh`, Bündel `rust`: baut die Bibliothek, das
  Backend-Binary und `tests/dev_present.rs` mit `--features dev-seeds` und fährt die Tests des
  Dev-Seeds (`dev::` in der Bibliothek, `dev_present`, Binary). Kein zweiter voller
  Workspace-Lauf.
- Die CI ruft das Skript wie bisher unverändert auf; der Job `Rust-Suite` (`--nur rust`) fährt
  den Schritt mit, ohne Änderung an `.github/workflows/ci.yml` und ohne neuen Pflicht-Check.
- `scripts/AGENTS.md` nennt den Schritt in der Gate-Kette.

## Capabilities

### New Capabilities
- `dev-seed-gate`: Der Code, der nur mit dem Cargo-Feature `dev-seeds` existiert (Dev-Seed,
  `/api/dev/users`, Dev-Zweige des Binaries), baut und besteht seine Tests vor dem Merge; das
  Sammel-Gate setzt das durch.

### Modified Capabilities
- keine

## Impact

- Gate und CI: `scripts/check-all.sh` (Schritt 15, Bündel `rust` wird `4 15`). Mehrlaufzeit im
  Job `Rust-Suite` rund 2 min: nur das eigene Crate wird mit dem Feature neu gebaut, keine
  Abhängigkeit (Messung in design.md).
- Arbeitsanleitungen: `scripts/AGENTS.md`.
- Kein Produktcode. Der heutige Stand von `alpha` ist mit dem Feature grün (Sweep, design.md).
- Nicht abgedeckt: die übrigen Bibliothekstests mit eingeschaltetem Feature (ein zweiter voller
  Lauf) und die e2e-Suite, die ohne das Feature läuft.
