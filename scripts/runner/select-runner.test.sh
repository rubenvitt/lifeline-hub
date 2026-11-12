#!/usr/bin/env bash
# Selbsttest für scripts/runner/select-runner.sh (LLH-1666, Spec `ci-eigener-runner`).
#
# Die Weiche irrt in eine gefährliche Richtung still: schickt sie einen Fork-PR auf den eigenen
# Server, läuft fremder Code dort, und kein Check wird rot. Die Fälle folgen den Szenarien der
# Spec. Die Weiche ist keine Sicherheitsgrenze (die ist die Fork-Freigabe im Repo, ADR), aber sie
# soll nie selbst die Tür öffnen.
set -euo pipefail

SKRIPT="$(cd "$(dirname "$0")" && pwd)/select-runner.sh"
fehler=0

fall() { # <beschreibung> <soll> <ereignis> <kopf-repo> <repo> <label>
  local ist
  ist="$("$SKRIPT" "$3" "$4" "$5" "$6")"
  if [ "$ist" = "$2" ]; then
    echo "ok   $1 → $ist"
  else
    echo "ROT  $1 → '$ist' (Soll '$2')" >&2
    fehler=1
  fi
}

R=rubenvitt/lifeline-hub
fall "PR aus dem eigenen Repo, Label gesetzt" lifeline-e2e pull_request "$R" "$R" lifeline-e2e
fall "PR aus einem Fork, Label gesetzt" ubuntu-latest pull_request jemand/lifeline-hub "$R" lifeline-e2e
fall "PR ohne Kopf-Repo (gelöschter Fork)" ubuntu-latest pull_request "" "$R" lifeline-e2e
fall "Push auf einen Kanal-Branch, Label gesetzt" lifeline-e2e push "" "$R" lifeline-e2e
fall "Label leer: eigener PR" ubuntu-latest pull_request "$R" "$R" ""
fall "Label leer: Push" ubuntu-latest push "" "$R" ""
fall "Label nur Leerzeichen" ubuntu-latest push "" "$R" "  "
fall "Label mit Leerzeichen drumherum" lifeline-e2e push "" "$R" " lifeline-e2e "
fall "pull_request_target zählt wie ein PR" ubuntu-latest pull_request_target jemand/x "$R" lifeline-e2e
fall "unbekanntes Ereignis bleibt auf GitHub" ubuntu-latest workflow_dispatch "" "$R" lifeline-e2e
fall "Repo-Name nur in Groß-/Kleinschreibung anders" lifeline-e2e pull_request RubenVitt/Lifeline-Hub "$R" lifeline-e2e

# Ein Label, das als Ausdruck oder Liste in `runs-on` landete, könnte mehr wählen als gemeint.
fall "Label mit Sonderzeichen wird abgewiesen" ubuntu-latest push "" "$R" 'a,b'
fall "Label mit Klammer wird abgewiesen" ubuntu-latest push "" "$R" '["self-hosted"]'

# Falsche Aufrufe brechen ab, statt still auf irgendeinen Runner zu zeigen.
if "$SKRIPT" push "" "$R" 2>/dev/null; then
  echo "ROT  drei Argumente statt vier → Exit 0 (Soll ≠ 0)" >&2
  fehler=1
else
  echo "ok   drei Argumente statt vier → Abbruch"
fi

exit "$fehler"
