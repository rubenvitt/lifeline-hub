#!/usr/bin/env bash
# LFH-235/F17: Sammel-Gate — die eine Durchsetzungsinstanz vor dem Merge.
#
# Vorher lagen alle Gates einzeln herum (check-fmt.sh, check-typ-codegen.sh, pnpm lint,
# pnpm typecheck, cargo test, pnpm test) und mussten von Hand einzeln aufgerufen werden.
# Bei paralleler Multi-Session-Entwicklung ist jedes Vergessen unsichtbar — Code landet
# auf main, ohne dass irgendein Gate maschinell gelaufen ist.
#
# Reihenfolge ist Absicht: erst die billigen, schnell scheiternden Prüfungen (Sekunden),
# dann die teuren Suiten (Minuten). Wer einen Formatierungsfehler hat, soll das nicht erst
# nach der Rust-Suite erfahren.
#
# Bewusst NICHT enthalten:
#  - `cargo clippy -D warnings`: der Bestand hat ~27 Warnungen (~10 distinkte Lints). Ein
#    Gate, das rot geboren wird, wird abgeschaltet statt befolgt. Erst aufräumen, dann
#    verdrahten — additiv nachrüstbar.
#  - `pnpm e2e`: die Harness ist bis LFH-247/F29 nicht selbsttragend (Backend muss separat
#    laufen). Danach kommt sie als eigener, bewusst aufgerufener Schritt dazu — nicht hier,
#    weil Chromium + Backend-Start die Laufzeit dieses Gates vervielfachen würden.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/dev-env.sh
. "$ROOT/scripts/lib/dev-env.sh"

FE="$ROOT/frontend"
PNPM="mise exec pnpm@11.10.0 -- pnpm"
SCHRITTE=6

geraeumt="$(dev_env_liste | tr '\n' ' ')"
if [ -n "${geraeumt// /}" ]; then
  echo "==> Dev-Variablen werden für die Testläufe geräumt: $geraeumt"
fi

echo "==> [1/$SCHRITTE] rustfmt-Baseline"
"$ROOT/scripts/check-fmt.sh"

echo "==> [2/$SCHRITTE] Frontend-Lint (--max-warnings 0)"
$PNPM -C "$FE" lint

echo "==> [3/$SCHRITTE] Typ-Drift Backend↔Frontend (enthält den Frontend-Typecheck)"
"$ROOT/scripts/check-typ-codegen.sh"

echo "==> [4/$SCHRITTE] Rust-Suite (Workspace)"
ohne_dev_env cargo test --workspace

echo "==> [5/$SCHRITTE] Frontend-Suite"
# --no-file-parallelism: die volle Vitest-Suite ist unter Last sonst flaky.
$PNPM -C "$FE" exec vitest run --no-file-parallelism

echo "==> [6/$SCHRITTE] Abhängigkeiten auf bekannte Schwachstellen prüfen"
"$ROOT/scripts/check-deps.sh"

echo
echo "==> OK: alle Gates grün."
