#!/usr/bin/env bash
# LFH-5: cargo-fmt-Gate.
#
# Hält die rustfmt-Baseline sauber, die LFH-5 einmalig übers ganze Repo hergestellt hat.
# `cargo fmt --check` bricht (mit Diff auf stdout), sobald Rust-Code vom rustfmt-Default-Stil
# abweicht — so driftet die Formatierung nicht erneut auseinander.
#
# Es gibt (noch) kein CI — dieser Gate wird lokal/vor dem Merge gefahren.
# Bei Fehlschlag: `cargo fmt` laufen lassen und die Formatierung mitcommitten.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> cargo fmt --all --check (rustfmt-Baseline, LFH-5)"
if ! cargo fmt --all --check; then
  echo "FEHLER: Rust-Code ist nicht rustfmt-clean." >&2
  echo "        'cargo fmt' laufen lassen und die Formatierung mitcommitten." >&2
  exit 1
fi

echo "==> OK: Rust-Code ist rustfmt-clean."
