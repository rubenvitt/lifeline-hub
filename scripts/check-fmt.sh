#!/usr/bin/env bash
# LFH-5: cargo-fmt-Gate. LFH-354: Prettier-Gate fürs Frontend daneben.
#
# ZWEI SPRACHEN, EIN SCHRITT. Beides ist dieselbe Frage — „weicht die Formatierung von der
# Baseline ab?" —, beides kostet Sekunden, und beides gehört deshalb in Schritt 1 des
# Sammel-Gates. Ein eigener Schritt fürs Frontend hätte check-all.sh umnummeriert, ohne eine
# andere Frage zu stellen.
#
# Rust: `cargo fmt --check` bricht (mit Diff auf stdout), sobald Rust-Code vom
# rustfmt-Default-Stil abweicht — so driftet die Formatierung nicht erneut auseinander.
#
# Frontend: `prettier --check` gegen frontend/.prettierrc. WARUM DAS ERST SEIT LFH-354 HIER
# STEHT, obwohl Prettier seit jeher als devDependency mitläuft: es lief in KEINEM Gate-Schritt.
# Die Folge war keine Warnung, sondern ein stiller Aufschlag auf fremde Diffs — wer eine
# Bestandsdatei anfasste und seine Editor-Formatierung mitschickte, produzierte einen Diff, der
# um ein Vielfaches größer war als die Änderung. Gemessen am Merge von LFH-352: zwei Dateien
# mit rund 250 Zeilen Diff, token-genau gegengeprüft reine Formatierung, keine Semantik.
#
# Das Gate kann nur stehen, weil der einmalige Sweep (LFH-354, 564 Dateien) davor lag — ein
# Gate, das rot geboren wird, wird abgeschaltet statt befolgt. Was der Sweep NICHT anfassen
# durfte, steht mit Begründung in frontend/.prettierignore; die generierten Dateien dort sind
# kein Geschmack, sondern der Riegel dagegen, dass dieses Gate und check-typ-codegen.sh
# einander brechen.
#
# Läuft lokal über scripts/check-all.sh und seit LFH-522 mit demselben Skript in der CI.
# Bei Fehlschlag: `cargo fmt` bzw. `prettier --write` laufen lassen und die Formatierung
# mitcommitten.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
FE="$ROOT/frontend"
# Node und pnpm gepinnt wie in check-all.sh und check-deps.sh: ein Formatier-Gate, dessen
# Werkzeugversion von der Maschine kommt, gibt für denselben Commit verschiedene Antworten —
# und Prettier ändert seinen Stil zwischen Major-Versionen. Wer die Zahlen dort ändert, ändert
# sie hier mit.
PNPM="mise exec node@26.7.0 pnpm@11.10.0 -- pnpm"

echo "==> [1/2] cargo fmt --all --check (rustfmt-Baseline, LFH-5)"
if ! cargo fmt --all --check; then
  echo "FEHLER: Rust-Code ist nicht rustfmt-clean." >&2
  echo "        'cargo fmt' laufen lassen und die Formatierung mitcommitten." >&2
  exit 1
fi

echo "==> [2/2] prettier --check (Frontend-Baseline, LFH-354)"
# `--check` listet die abweichenden Dateien und bricht; es schreibt nichts. Der Lauf schließt
# das ganze Frontend ein (src/, e2e/, Konfigurationsdateien), abzüglich .prettierignore.
if ! $PNPM -C "$FE" exec prettier --check .; then
  echo "FEHLER: Frontend-Code ist nicht prettier-clean." >&2
  echo "        'pnpm -C frontend exec prettier --write .' laufen lassen und die" >&2
  echo "        Formatierung mitcommitten." >&2
  echo "        Gehört die Datei gar nicht dazu (generiert, Werkzeugausgabe), gehört sie" >&2
  echo "        mit Begründung in frontend/.prettierignore — nicht in einen Einzelfall-Fix." >&2
  exit 1
fi

echo "==> OK: Rust ist rustfmt-clean, Frontend ist prettier-clean."
