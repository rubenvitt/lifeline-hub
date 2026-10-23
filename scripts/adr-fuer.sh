#!/usr/bin/env bash
# Welche Architekturentscheidungen gelten für diese Pfade? (LLH-1435)
#
# Nennt je akzeptierter oder vorgeschlagener ADR, deren `gilt_fuer` einen der Pfade trifft,
# Kennung, Titel und Datei, darunter ihre Regeln. Agenten rufen das vor einer Änderung auf
# (docs/architektur/AGENTS.md, „Pflege durch Agenten“). Ohne Treffer: eine Zeile, Exit 0.
#
# Aufruf: scripts/adr-fuer.sh <pfad>…        Pfade relativ zur Repo-Wurzel
#         git diff --name-only origin/alpha | scripts/adr-fuer.sh -
set -euo pipefail

SKRIPTE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SKRIPTE/.." && pwd)"
# shellcheck source=lib/adr.sh
. "$SKRIPTE/lib/adr.sh"

if [ $# -eq 0 ]; then
  echo "Aufruf: scripts/adr-fuer.sh <pfad>…   (oder '-' für Pfade über stdin)" >&2
  exit 2
fi
pfade=()
for a in "$@"; do
  if [ "$a" = - ]; then
    while IFS= read -r z; do [ -n "$z" ] && pfade+=("$z"); done
  else
    pfade+=("$a")
  fi
done

treffer=0
for adr in "$ROOT"/docs/architektur/entscheidungen/ADR-*.md; do
  [ -e "$adr" ] || continue
  status="$(adr_kopf_wert "$adr" status)"
  case "$status" in akzeptiert | vorgeschlagen) ;; *) continue ;; esac
  passt=""
  while IFS= read -r m; do
    [ -n "$m" ] || continue
    for p in "${pfade[@]}"; do
      if adr_muster_trifft "$m" "$p"; then passt="$p"; break 2; fi
    done
  done <<< "$(adr_kopf_liste "$adr" gilt_fuer)"
  [ -n "$passt" ] || continue
  treffer=$((treffer + 1))
  zusatz=""
  [ "$status" = vorgeschlagen ] && zusatz=" (vorgeschlagen, noch nicht verbindlich)"
  echo "$(adr_kopf_wert "$adr" id): $(adr_kopf_wert "$adr" titel)$zusatz"
  echo "  ${adr#"$ROOT"/}  (trifft $passt)"
  # Regeln samt umbrochener Fortsetzungszeilen.
  awk '
    /^## / { a = $0; fort = 0; next }
    a == "## Regeln" && /^- / { print "  " $0; fort = 1; next }
    a == "## Regeln" && fort && /^  +[^ ]/ { print "  " $0; next }
    { fort = 0 }
  ' "$adr"
done

if [ "$treffer" -eq 0 ]; then
  echo "Keine Architekturentscheidung gilt für diese Pfade."
fi
