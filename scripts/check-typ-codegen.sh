#!/usr/bin/env bash
# LFH-120: Typ-Drift-Gate Backend↔Frontend.
#
# Fängt beide Drift-Klassen:
#  1. Backend-Struct/Enum geändert, aber openapi.json/types.generated.ts nicht regeneriert
#     → dieser Gate schreibt neu und bricht per `git diff --exit-code`.
#  2. Ein generierter Feldname wurde umbenannt/entfernt, den ein FE-Konsument nutzt
#     → `tsc` bricht.
#
# Es gibt (noch) kein CI — dieser Gate wird lokal/vor dem Merge gefahren.
# Nach einer Backend-Typänderung: dieses Skript laufen lassen, die regenerierten
# Dateien committen.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=lib/dev-env.sh
. "$ROOT/scripts/lib/dev-env.sh"
FE="$ROOT/frontend"
PNPM="mise exec pnpm@11.10.0 -- pnpm"

echo "==> [1/4] openapi.json aus dem Backend emittieren + gegen committete Version prüfen"
# openapi_spec_aktuell schreibt frontend/src/api/openapi.json neu, wenn es vom Code abweicht,
# und schlägt dann fehl. ohne_dev_env: Dev-Vars aus mise/.env leaken sonst in den Testlauf.
# Früher stand hier eine handgepflegte `env -u`-Liste mit drei Variablen, während die .env
# dreizehn setzte — genau diese Drift hat später die OIDC-Config-Tests gekippt (LFH-235/F17).
ohne_dev_env cargo test --test openapi_spec_aktuell

echo "==> [2/4] types.generated.ts aus openapi.json regenerieren"
$PNPM -C "$FE" gen:types

echo "==> [3/4] Drift-Check: sind die generierten Dateien committet-aktuell?"
if ! git diff --exit-code -- frontend/src/api/openapi.json frontend/src/api/types.generated.ts; then
  echo "FEHLER: openapi.json / types.generated.ts sind nicht aktuell." >&2
  echo "        Backend-Typen wurden geändert, aber die generierten Dateien nicht regeneriert+committet." >&2
  echo "        Obige Diff-Änderungen prüfen und committen." >&2
  exit 1
fi

echo "==> [4/4] Frontend-Typecheck (fängt umbenannte/entfernte Felder in Konsumenten)"
$PNPM -C "$FE" typecheck

echo "==> OK: Backend↔Frontend-Typen sind in Sync."
