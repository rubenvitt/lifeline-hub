#!/usr/bin/env bash
# LFH-253/G01: Abhängigkeiten gegen Advisory-Datenbanken prüfen.
#
# Die Lockfiles (Cargo.lock, frontend/pnpm-lock.yaml) sind committet und machen Builds
# reproduzierbar — genau deshalb frieren sie verwundbare Versionen aber auch dauerhaft ein.
# Ohne diesen Scan erzeugt ein neues RUSTSEC-/GHSA-Advisory kein Signal und landet still im
# ausgelieferten Binary eines Einsatzführungssystems.
#
# Zwei Bäume, nicht drei: karten-service ist Workspace-Member unter einem gemeinsamen
# Cargo.lock, ein `cargo audit` im Root deckt alle Rust-Crates ab.
#
# Netzabhängig und nicht-deterministisch — anders als die übrigen Gates. Ein neu
# veröffentlichtes Advisory macht diesen Schritt über Nacht rot, ohne dass sich eine Zeile
# Code geändert hat. Das ist gewollt (es ist ja das Signal), aber der Grund, warum der Scan
# NICHT im Release-Pfad (build-release.sh) hängt: ein Offline-Build soll nicht daran
# scheitern.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
FE="$ROOT/frontend"
PNPM="mise exec pnpm@11.10.0 -- pnpm"

fehlend=()

echo "==> [1/2] Rust-Abhängigkeiten (cargo audit, RUSTSEC)"
if command -v cargo-audit >/dev/null 2>&1 || cargo audit --version >/dev/null 2>&1; then
  cargo audit
else
  fehlend+=("cargo-audit  →  cargo install cargo-audit")
  echo "    ÜBERSPRUNGEN: cargo-audit ist nicht installiert."
fi

echo "==> [2/2] Frontend-Abhängigkeiten (pnpm audit, GHSA)"
# --audit-level=high bricht; moderate/low werden gemeldet, brechen aber nicht — sonst wäre
# das Gate durch Dev-Tooling-Rauschen dauerrot und würde abgeschaltet.
$PNPM -C "$FE" audit --audit-level=high

if [ ${#fehlend[@]} -gt 0 ]; then
  echo
  echo "WARNUNG: Dieser Scan lief UNVOLLSTÄNDIG — folgende Werkzeuge fehlen:" >&2
  for w in "${fehlend[@]}"; do echo "  - $w" >&2; done
  echo "         Das Gate meldet deshalb keinen Fund, hat aber auch nicht vollständig gesucht." >&2
  echo "         (Bewusst kein harter Fehler: sonst wäre check-all.sh auf jeder Maschine rot," >&2
  echo "          auf der das Werkzeug fehlt — und ein rotes Gate wird abgeschaltet.)" >&2
  exit 0
fi

echo "==> OK: keine bekannten Schwachstellen in den gepinnten Abhängigkeiten."
