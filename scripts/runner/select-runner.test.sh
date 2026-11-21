#!/usr/bin/env bash
# Selbsttest für scripts/runner/select-runner.sh (LLH-1666, LLH-2014, ADR-0075).
#
# Die Weiche irrt in eine gefährliche Richtung still: schickt sie einen PR auf den eigenen
# Server, läuft dort Code, den niemand gemergt hat, und kein Check wird rot. Die Weiche ist keine
# Sicherheitsgrenze (die ist die Fork-Freigabe im Repo, ADR-0075), aber sie soll nie selbst die
# Tür öffnen.
set -euo pipefail

SKRIPT="$(cd "$(dirname "$0")" && pwd)/select-runner.sh"
fehler=0

fall() { # <beschreibung> <soll> <ereignis> <label>
  local ist
  ist="$("$SKRIPT" "$3" "$4")"
  if [ "$ist" = "$2" ]; then
    echo "ok   $1 → $ist"
  else
    echo "ROT  $1 → '$ist' (Soll '$2')" >&2
    fehler=1
  fi
}

fall "Push auf einen Kanal-Branch, Label gesetzt" lifeline-e2e push lifeline-e2e
# PR-Läufe nie auf dem Server (LLH-2014), auch nicht mit dem Label `voll` und nicht aus dem
# eigenen Repo: die Weiche sieht nur das Ereignis.
fall "PR (auch mit voll) bleibt auf GitHub" ubuntu-latest pull_request lifeline-e2e
fall "pull_request_target bleibt auf GitHub" ubuntu-latest pull_request_target lifeline-e2e
fall "unbekanntes Ereignis bleibt auf GitHub" ubuntu-latest workflow_dispatch lifeline-e2e
fall "Label leer: Push" ubuntu-latest push ""
fall "Label leer: PR" ubuntu-latest pull_request ""
fall "Label nur Leerzeichen" ubuntu-latest push "  "
fall "Label mit Leerzeichen drumherum" lifeline-e2e push " lifeline-e2e "

# Ein Label, das als Ausdruck oder Liste in `runs-on` landete, könnte mehr wählen als gemeint.
fall "Label mit Sonderzeichen wird abgewiesen" ubuntu-latest push 'a,b'
fall "Label mit Klammer wird abgewiesen" ubuntu-latest push '["self-hosted"]'

# Falsche Aufrufe brechen ab, statt still auf irgendeinen Runner zu zeigen. Vier Argumente sind
# der Aufruf der alten Weiche: stößt ein alter Workflow auf die neue (oder umgekehrt), fällt der
# Lauf über `continue-on-error` auf GitHub zurück.
for argumente in "push" "push x y lifeline-e2e"; do
  # shellcheck disable=SC2086 # Absicht: Wörter als einzelne Argumente
  if "$SKRIPT" $argumente > /dev/null 2>&1; then
    echo "ROT  Aufruf mit '$argumente' → Exit 0 (Soll ≠ 0)" >&2
    fehler=1
  else
    echo "ok   Aufruf mit '$argumente' → Abbruch"
  fi
done

exit "$fehler"
