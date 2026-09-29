#!/usr/bin/env bash
# Formatier-Gate: `cargo fmt --check` fürs Backend, `prettier --check` fürs Frontend — dieselbe
# Frage, deshalb EIN Schritt (Schritt 1 des Sammel-Gates).
#
# Was Prettier nicht anfassen darf, steht mit Begründung in frontend/.prettierignore: die
# generierten Dateien dort verhindern, dass dieses Gate und check-typ-codegen.sh einander
# brechen.
#
# Bei Fehlschlag: `cargo fmt` bzw. `prettier --write` laufen lassen (Prettier ggf. zweimal,
# es ist nicht idempotent) und die Formatierung mitcommitten.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
FE="$ROOT/frontend"
# Node und pnpm gepinnt wie in check-all.sh: Prettier ändert seinen Stil zwischen
# Major-Versionen, und das Gate soll überall dasselbe sagen.
PNPM="mise exec node@26.7.0 pnpm@11.10.0 -- pnpm"

echo "==> [1/2] cargo fmt --all --check (rustfmt-Baseline, LFH-5)"
if ! cargo fmt --all --check; then
  echo "FEHLER: Rust-Code ist nicht rustfmt-clean." >&2
  echo "        'cargo fmt' laufen lassen und die Formatierung mitcommitten." >&2
  exit 1
fi

echo "==> [2/2] prettier --check (Frontend-Baseline, LFH-354)"
# `--check` listet abweichende Dateien und schreibt nichts. Geprüft wird `frontend/`, nicht
# das Repo-Root: dort liegen Dateien (release.config.mjs, Workflows, CLAUDE.md), für die keine
# Prettier-Baseline hergestellt ist — wer die Grenze verschiebt, fährt erst den Sweep.
if ! $PNPM -C "$FE" exec prettier --check .; then
  echo "FEHLER: Frontend-Code ist nicht prettier-clean." >&2
  echo "        'pnpm -C frontend exec prettier --write .' laufen lassen und die" >&2
  echo "        Formatierung mitcommitten." >&2
  echo "        Gehört die Datei gar nicht dazu (generiert, Werkzeugausgabe), gehört sie" >&2
  echo "        mit Begründung in frontend/.prettierignore — nicht in einen Einzelfall-Fix." >&2
  exit 1
fi

echo "==> OK: Rust ist rustfmt-clean, Frontend ist prettier-clean."
