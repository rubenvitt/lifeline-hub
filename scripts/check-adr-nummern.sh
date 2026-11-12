#!/usr/bin/env bash
# LLH-1660: ADR-Nummern gegen den AKTUELLEN Ziel-Branch prüfen.
#
#   scripts/check-adr-nummern.sh [<basis>] [<kopf>]
#     <basis>  Ziel-Branch, gegen den geprüft wird   (Vorgabe: origin/alpha)
#     <kopf>   geprüfter Stand                        (Vorgabe: HEAD)
#   Exit 0 = in Ordnung · 1 = Verstoß · 2 = Aufruf- oder Umgebungsfehler
#
# `check-architektur.sh` meldet eine doppelte ADR-`id` nur auf dem eigenen Stand. Zwei PRs,
# die je für sich eine freie Nummer nehmen, kollidieren in Git nicht (verschiedene Dateinamen)
# und machten `alpha` zusammen rot. Dieses Skript sieht beide Seiten; `migrationen.yml` setzt
# damit den Commit-Status `ADR-Nummern` für jeden offenen PR.
#
# DIE REGELN (Spec `adr-nummernvergabe`, docs/architektur/AGENTS.md, „Entscheidungen (ADRs)“):
#   1. Eine ADR, die der Branch gegenüber seiner ABZWEIGUNG neu mitbringt, trägt eine Nummer,
#      die auf der BASIS keine andere ADR-Datei trägt. Eine Lücke zu füllen ist erlaubt.
#   2. Die neuen ADRs eines Branches tragen untereinander verschiedene Nummern.
#
# Geprüft wird, was COMMITTET ist (Diff Abzweigung..Kopf). Benennt der Branch eine bestehende
# ADR um, zählt ihr alter Name auf der Basis nicht als fremd. Behoben wird nichts: eine ADR
# umzunummerieren ändert `id`, Dateinamen und Verweise und gehört dem, der den PR betreut.
set -euo pipefail

case "${1:-}" in -h | --help) sed -n '2,7p' "$0"; exit 0 ;; esac
[ $# -le 2 ] || { echo "FEHLER: höchstens <basis> und <kopf>." >&2; exit 2; }
BASIS="${1:-origin/alpha}"
KOPF="${2:-HEAD}"
ORDNER="docs/architektur/entscheidungen"

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
git() { command git -c core.quotePath=false "$@"; }

commit_von() { # <ref> <rolle>
  git rev-parse --verify --quiet "$1^{commit}" || {
    echo "FEHLER: $2 '$1' ist kein Commit (fehlt ein 'git fetch'?)." >&2
    exit 2
  }
}
B="$(commit_von "$BASIS" Basis)"
K="$(commit_von "$KOPF" Kopf)"
M="$(git merge-base "$K" "$B")" || {
  echo "FEHLER: '$KOPF' und '$BASIS' haben keine gemeinsame Abzweigung." >&2
  exit 2
}

# Nummer einer ADR-Datei (`ADR-0025-slug.md`); leer, wenn der Name nicht passt.
nummer() {
  local name="${1##*/}"
  if [[ "$name" =~ ^ADR-([0-9]{4})-.+\.md$ ]]; then
    printf '%d\n' "$((10#${BASH_REMATCH[1]}))"
  fi
}

neue=()
entfernt=" "
while IFS=$'\t' read -r status pfad; do
  [ -n "$(nummer "$pfad")" ] || continue
  case "$status" in
    A) neue+=("$pfad") ;;
    D) entfernt="$entfernt$pfad " ;;
  esac
done < <(git diff --no-renames --name-status "$M" "$K" -- "$ORDNER/")

# ADRs der Basis, ohne die, die der Branch selbst umbenannt oder entfernt hat.
basis_pfade=()
hoechste=0
while IFS= read -r pfad; do
  n="$(nummer "$pfad")"
  [ -n "$n" ] || continue
  [ "$n" -gt "$hoechste" ] && hoechste="$n"
  case "$entfernt" in *" $pfad "*) continue ;; esac
  basis_pfade+=("$pfad")
done < <(git ls-tree --name-only "$B" "$ORDNER/")

verstoesse=()
gesehen=" "
for pfad in ${neue[@]+"${neue[@]}"}; do
  n="$(nummer "$pfad")"
  [ "$n" -gt "$hoechste" ] && hoechste="$n"
  for b in ${basis_pfade[@]+"${basis_pfade[@]}"}; do
    if [ "$(nummer "$b")" = "$n" ] && [ "$b" != "$pfad" ]; then
      verstoesse+=("$(printf '%s: Nummer %04d trägt auf %s schon %s' "$pfad" "$n" "$BASIS" "${b##*/}")")
    fi
  done
  case "$gesehen" in
    *" $n "*) verstoesse+=("$(printf 'Nummer %04d mehrfach im Branch: %s' "$n" "$pfad")") ;;
  esac
  gesehen="$gesehen$n "
done

if [ "${#verstoesse[@]}" -eq 0 ]; then
  printf '==> OK: %d neue ADR(s), keine Nummer auf %s vergeben.\n' "${#neue[@]}" "$BASIS"
  exit 0
fi

echo "==> FEHLER: ADR-Nummern gegen $BASIS verletzt:" >&2
for v in "${verstoesse[@]}"; do echo "    - $v" >&2; done
printf '    Nächste freie Nummer: ADR-%04d. Umnummerieren heißt: Dateiname, `id` im Kopf und\n' \
  "$((hoechste + 1))" >&2
echo "    jeden Verweis auf die Datei ändern (docs/architektur/AGENTS.md, „Entscheidungen (ADRs)“)." >&2
exit 1
