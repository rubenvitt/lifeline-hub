#!/usr/bin/env bash
# Python-Beispiel des Maschinenzugangs gegen die Testvektoren (LLH-1652, design.md D9).
# Rust-Client, Server und TypeScript-Modul prüfen dieselbe Datei in ihren Suiten
# (`cargo test`, Vitest); dieser Schritt deckt das Python-Beispiel ab.
#
# Ohne `python3` oder ohne das Paket `cryptography` wird der Schritt laut übersprungen, nicht rot:
# ein rot geborenes Gate würde abgeschaltet statt befolgt (Wurzel-AGENTS.md, Qualitäts-Gates).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BEISPIEL="$ROOT/docs/api/clients/python/machine_client.py"
VEKTOREN="$ROOT/docs/api/machine-auth-testvektoren.json"

if ! command -v python3 > /dev/null 2>&1; then
  echo "    ÜBERSPRUNGEN: python3 fehlt (Python-Beispiel des Maschinenzugangs)." >&2
  exit 0
fi
if ! python3 -I -c 'import cryptography' > /dev/null 2>&1; then
  echo "    ÜBERSPRUNGEN: Python-Paket 'cryptography' fehlt (pip install cryptography)." >&2
  exit 0
fi
python3 -I "$BEISPIEL" --selftest "$VEKTOREN"
