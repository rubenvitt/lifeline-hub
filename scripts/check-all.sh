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
#
# `pnpm e2e` ist seit LFH-309 selbsttragend (startet Backend und Vite selbst) und läuft als
# Schritt 7 mit — aber NUR, wenn target/debug/lifeline-hub daliegt, sonst übersprungen mit
# lautem Hinweis statt eines harten Fehlers (Muster wie check-deps.sh bei fehlendem
# cargo-audit): die Suite kann das Binary nicht selbst bauen, ohne jeden Lauf um Minuten
# zu verlängern, und ein Gate, das auf frischem Checkout rot ist, wird abgeschaltet.
#
# In der Praxis greift der Guard hier fast nie, und das ist Absicht, kein Widerspruch:
# `cargo test --workspace` in Schritt 4 baut das bin-Target ohnehin mit (gemessen — das
# beiseitegeschobene Binary lag nach dem Lauf wieder da und e2e lief). Innerhalb dieses
# Skripts ist e2e damit faktisch immer dabei (+~30 s). Der Guard ist das Netz für alles
# andere: verkürzte Läufe, umgebaute Reihenfolge, Aufruf einzelner Schritte von Hand.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/dev-env.sh
. "$ROOT/scripts/lib/dev-env.sh"

FE="$ROOT/frontend"
PNPM="mise exec pnpm@11.10.0 -- pnpm"
SCHRITTE=7

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

echo "==> [7/$SCHRITTE] e2e-Suite (Playwright, LFH-309)"
BINAER="$ROOT/target/debug/lifeline-hub"
if [ -x "$BINAER" ]; then
  # Die Suite startet Backend und Vite selbst auf freien Ports — ein parallel laufender
  # Dev-Stack auf 8080/5173 stört sie nicht und wird nicht gekapert.
  $PNPM -C "$FE" exec playwright test
else
  echo "    ÜBERSPRUNGEN: $BINAER fehlt." >&2
  echo "    Die e2e-Suite startet das Backend selbst und setzt einen Debug-Build voraus." >&2
  echo "    Einmal 'cargo build' laufen lassen, dann deckt dieses Gate auch die Fehler-" >&2
  echo "    klassen ab, die nur der echte Browser sieht (Layout, WebGL, StrictMode)." >&2
  echo "    (Bewusst kein harter Fehler: auf einem frischen Checkout wäre das Gate sonst" >&2
  echo "     von Tag eins rot — und ein rotes Gate wird abgeschaltet statt befolgt.)" >&2
fi

echo
echo "==> OK: alle Gates grün."
