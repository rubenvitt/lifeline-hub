#!/usr/bin/env bash
# Prüft die Pflicht-Checks im Ruleset von `alpha` (LLH-1895, Regel: `scripts/AGENTS.md`,
# „Leichte PR-Prüfung“).
#
#   gh api repos/<repo>/rules/branches/alpha | scripts/ruleset-pruefen.sh
#   scripts/ruleset-pruefen.sh --liste      die Pflichtliste, je Zeile <name>\t<art>
#
# Exit 0: in Ordnung. Exit 1: Abweichung, je Zeile eine. Exit 2: Antwort nicht lesbar.
#
# WARUM: Am 14.11.2026 bekam `Migrationsnummern` beim Bearbeiten des Rulesets die Quelle „GitHub
# Actions“. Ein Commit-Status, den die CI über die Status-API setzt, zählt dann nicht mehr; alle
# grünen PRs standen über Nacht auf `blocked`, ohne dass ein Check rot war.
#
# Die Antwort kommt über stdin, nicht aus einem eigenen API-Aufruf: so reicht der Stau-Wächter
# seine Attrappe durch, und der Selbsttest (`ruleset-pruefen.test.sh`) läuft ohne Netz.
set -euo pipefail

# ── DIE PFLICHTLISTE, die einzige Stelle im Repository ───────────────────────────────────────
# <name>|<art>. Art `status`: Commit-Status über die Status-API (`migrationen.yml`); MUSS im
# Ruleset ohne Quelle stehen. Art `check`: Check-Run eines Jobs oder über die Checks-API mit dem
# Token von GitHub Actions; ohne Quelle oder mit GitHub Actions.
PFLICHT=(
  "Schnellprüfungen|check"
  "Migrationsnummern|status"
  "ADR-Nummern|status"
  "Baut mit Ziel-Branch|check"
)
# App-ID von GitHub Actions: die Quelle, die ein Check-Run mit `GITHUB_TOKEN` trägt.
GITHUB_ACTIONS_APP=15368

if [ "${1:-}" = --liste ]; then
  for p in "${PFLICHT[@]}"; do printf '%s\t%s\n' "${p%%|*}" "${p##*|}"; done
  exit 0
fi

antwort="$(cat)"
[ -n "$antwort" ] || { echo "Die Regeln von alpha sind nicht lesbar: leere Antwort"; exit 2; }
# Alle Regeln `required_status_checks` (mehrere Rulesets können für alpha gelten).
if ! regeln="$(jq -c 'if type != "array" then error("keine Liste") else . end
    | [.[] | select(.type == "required_status_checks")]' <<< "$antwort" 2> /dev/null)"; then
  echo "Die Regeln von alpha sind nicht lesbar: ${antwort:0:200}"
  exit 2
fi
# Je Pflicht-Check im Ruleset eine Zeile <context>\t<integration_id oder ->. Eine Regel in
# unerwarteter Form ist „nicht lesbar“ (Exit 2), nie ein Abbruch mit dem Exit von jq.
if ! eintraege="$(jq -r '.[] | .parameters.required_status_checks // []
    | if type != "array" then error("keine Liste") else .[] end
    | if type != "object" or (.context | type) != "string" then error("kein Eintrag") else . end
    | [.context, (.integration_id // "-" | tostring)] | @tsv' <<< "$regeln" 2> /dev/null)" \
  || ! strict="$(jq -r 'any(.[]; .parameters.strict_required_status_checks_policy == true)' <<< "$regeln" 2> /dev/null)"; then
  echo "Die Regeln von alpha sind nicht lesbar (unerwartete Form): ${antwort:0:200}"
  exit 2
fi

art_von() { # <name> → status | check | leer
  local p
  for p in "${PFLICHT[@]}"; do
    [ "${p%%|*}" = "$1" ] && { printf '%s' "${p##*|}"; return 0; }
  done
  return 0
}

befunde=()
gesehen=$'\n'
[ "$strict" != true ] \
  || befunde+=("„Require branches to be up to date before merging“ ist an: jeder PR müsste vor dem Merge auf dem Stand des Ziel-Branches sein (ADR-0030). Im Ruleset ausschalten.")
while IFS=$'\t' read -r name quelle; do
  [ -n "$name" ] || continue
  [ "$quelle" != - ] || quelle=""
  gesehen+="$name"$'\n'
  art="$(art_von "$name")"
  case "$art" in
    "")
      befunde+=("\`$name\` ist im Ruleset Pflicht, aber nicht vereinbart (läuft er im PR überhaupt?). Austragen oder in die Liste in scripts/ruleset-pruefen.sh aufnehmen.") ;;
    status)
      [ -z "$quelle" ] || befunde+=("\`$name\` trägt im Ruleset die Quelle App $quelle. Der Commit-Status zählt dann nicht, und kein PR mergt. Quelle auf „Any source“ stellen.") ;;
    check)
      [ -z "$quelle" ] || [ "$quelle" = "$GITHUB_ACTIONS_APP" ] \
        || befunde+=("\`$name\` trägt im Ruleset die Quelle App $quelle statt GitHub Actions. Quelle auf „Any source“ oder „GitHub Actions“ stellen.") ;;
  esac
done <<< "$eintraege"

for p in "${PFLICHT[@]}"; do
  name="${p%%|*}"
  case "$gesehen" in
    *$'\n'"$name"$'\n'*) ;;
    *) befunde+=("\`$name\` fehlt im Ruleset als Pflicht-Check.") ;;
  esac
done

if [ "${#befunde[@]}" -eq 0 ]; then
  echo "Ruleset von alpha: Pflicht-Checks in Ordnung."
  exit 0
fi
printf '%s\n' "${befunde[@]}"
exit 1
