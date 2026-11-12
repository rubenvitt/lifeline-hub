#!/usr/bin/env bash
# LLH-1660: Kostet ein Umnummerierungs-Commit die schweren Suiten noch einmal?
#
#   scripts/nur-umnummeriert.sh vorgaenger <kopf>
#       Gibt den Commit aus, dessen Suiten für <kopf> gelten dürfen, oder nichts.
#   scripts/nur-umnummeriert.sh gruen < check-runs.json
#       Exit 0, wenn die schweren Suiten in den Check-Runs (Antwort von
#       `gh api repos/…/commits/<sha>/check-runs --paginate`) alle grün waren, sonst 1.
#   Exit 2 = Aufruf- oder Umgebungsfehler
#
# Der Migrations-Autofix (`migrationen-autofix.sh`) pusht einen Commit, der nur Dateien unter
# `migrations/` umbenennt. Die Pflicht-Checks hängen am Kopf-Commit, also liefen Rust, Vitest und
# e2e danach noch einmal voll (e2e bis über eine Stunde), für denselben Inhalt. Der Job
# `aenderungen` in `ci.yml` fragt deshalb dieses Skript: Unterscheidet sich der Kopf vom letzten
# Commit mit grünen schweren Suiten nur durch solche Umbenennungen, laufen sie leer durch.
#
# `vorgaenger` geht vom Kopf rückwärts, solange jeder Commit
#   (a) den Trailer des Autofix trägt,
#   (b) genau einen Elternteil hat,
#   (c) mindestens eine Migration unverändert umbenennt (R100), und zwar so, wie der Autofix es
#       tut: `migrations/NNNN_name.sql` auf eine HÖHERE Nummer mit demselben Namen, ohne die
#       Reihenfolge der umbenannten Dateien zu ändern, und
#   (d) daneben nur Dateien ändert, die laut `bereiche.sh` keine schwere Suite liest (der Autofix
#       zieht Verweise auf den Dateinamen mit, etwa im Glossar),
# höchstens SCHRITTE_MAX Commits weit. Ausgegeben wird der erste Commit, der das nicht erfüllt.
# Entschieden wird am INHALT, nicht am Autor. Eine Umbenennung ist nicht von selbst harmlos: eine
# kleinere Nummer oder eine andere Reihenfolge ändert, was sqlx wann einspielt, eine andere
# Endung nimmt die Migration aus dem Lauf. Deshalb (c) so eng. Zieht der Autofix einen Verweis
# in Code mit (`include_str!`), liest den eine Suite: dann läuft alles. Im Zweifel wird geprüft.
#
# WAS ÜBERNOMMEN WIRD: Frontend- und e2e-Suite. Die RUST-SUITE LÄUFT IMMER NEU (Job
# `aenderungen` in ci.yml): der PR-Lauf prüft den Merge mit dem aktuellen Ziel-Branch, und eine
# Nummernkollision heißt, dass dort eine fremde Migration dazukam. Ob beide Migrationen
# zusammen einspielen und die Tests bestehen, zeigt nur dieser Lauf.
set -euo pipefail

TRAILER_SCHLUESSEL="Migrationsnummern-Autofix" # wie in migrationen-autofix.sh
SCHRITTE_MAX=5
# Die schweren Pflicht-Checks, wie `ci.yml` sie nennt. Der Selbsttest vergleicht die Liste mit
# dem Workflow: ein umbenannter oder neuer Anteil fiele sonst still aus der Prüfung.
SCHWERE_CHECKS=(
  "Rust-Suite"
  "Frontend-Suite 1/4" "Frontend-Suite 2/4" "Frontend-Suite 3/4" "Frontend-Suite 4/4"
  "e2e 1/4" "e2e 2/4" "e2e 3/4" "e2e 4/4"
)

SKRIPTE="$(cd "$(dirname "$0")" && pwd)"
git() { command git -c core.quotePath=false "$@"; }

# Nummer und Name einer Migration als "<nummer> <name>" (`migrations/0143_b.sql` → "143 b.sql");
# leer, wenn der Pfad keine Migration direkt unter `migrations/` mit vierstelliger Nummer ist.
migration_teile() {
  local name="${1#migrations/}"
  case "$1" in migrations/*) ;; *) return 0 ;; esac
  if [[ "$name" =~ ^([0-9]{4})_([^/]+\.sql)$ ]]; then
    printf '%d %s\n' "$((10#${BASH_REMATCH[1]}))" "${BASH_REMATCH[2]}"
  fi
}

# Ist <commit> eine reine Umnummerierung des Autofix?
ist_umnummerierung() {
  local c="$1" trailer eltern zeilen status alt neu a b
  local a_nr a_name b_nr b_name paare="" andere="" bereiche
  trailer="$(git log -1 --format="%(trailers:key=$TRAILER_SCHLUESSEL,valueonly)" "$c")"
  [ -n "$trailer" ] || return 1
  eltern="$(git rev-list --parents -n 1 "$c" | wc -w | tr -d ' ')"
  [ "$eltern" = 2 ] || return 1 # der Commit selbst plus genau ein Elternteil
  zeilen="$(git diff-tree -r --no-commit-id --find-renames=100% --name-status "$c^" "$c")"
  [ -n "$zeilen" ] || return 1
  while IFS=$'\t' read -r status alt neu; do
    a="$(migration_teile "$alt")"
    b="$(migration_teile "${neu:-}")"
    if [ "$status" = R100 ] && [ -n "$a" ] && [ -n "$b" ]; then
      read -r a_nr a_name <<< "$a"
      read -r b_nr b_name <<< "$b"
      # Gleicher Name, höhere Nummer: so benennt der Autofix um, und nur so.
      [ "$a_name" = "$b_name" ] && [ "$b_nr" -gt "$a_nr" ] || return 1
      paare="$paare$a_nr $b_nr"$'\n'
      continue
    fi
    # Alles andere, auch eine Migration, die nicht unverändert umbenannt wurde: `bereiche.sh`
    # entscheidet. `migrations/*` fordert dort die Rust-Suite, also läuft dann alles.
    andere="$andere$alt"$'\n'
    [ -n "${neu:-}" ] && andere="$andere$neu"$'\n'
  done <<< "$zeilen"
  [ -n "$paare" ] || return 1
  # Die Reihenfolge der umbenannten Migrationen bleibt: nach alter Nummer sortiert steigen auch
  # die neuen Nummern.
  printf '%s' "$paare" | sort -n -k1,1 | awk '{ if ($2 <= vor) exit 1; vor = $2 }' || return 1
  if [ -n "$andere" ]; then
    # Nur drei ausdrückliche `=false` sparen. Scheitert bereiche.sh oder schweigt es, wird geprüft.
    bereiche="$(printf '%s' "$andere" | "$SKRIPTE/bereiche.sh")" || return 1
    [ "$(printf '%s\n' "$bereiche" | grep -c '=false$')" = 3 ] || return 1
    printf '%s\n' "$bereiche" | grep -q '=true' && return 1
  fi
  return 0
}

vorgaenger() {
  local c schritte=0
  c="$(git rev-parse --verify --quiet "$1^{commit}")" || {
    echo "FEHLER: '$1' ist kein Commit (fehlt ein 'git fetch'?)." >&2
    exit 2
  }
  while ist_umnummerierung "$c"; do
    schritte=$((schritte + 1))
    # Eine längere Kette ist kein Normalfall (der Autofix selbst setzt nach drei aus).
    [ "$schritte" -le "$SCHRITTE_MAX" ] || return 0
    # Fehlt der Elternteil im flachen Checkout, gibt es keinen Vorgänger zu nennen.
    c="$(git rev-parse --verify --quiet "$c^")" || return 0
  done
  [ "$schritte" -gt 0 ] && printf '%s\n' "$c"
  return 0
}

gruen() {
  command -v jq > /dev/null || { echo "FEHLER: jq fehlt." >&2; exit 2; }
  local namen fehlend
  namen="$(printf '%s\n' "${SCHWERE_CHECKS[@]}" | jq -R . | jq -s .)"
  # Je Name zählt der jüngste Check-Run (ein neu gestarteter Job hängt einen weiteren an).
  # `success` und `skipped` gelten: eine Suite, die `bereiche.sh` nicht brauchte, ist übersprungen.
  fehlend="$(jq -r -s --argjson namen "$namen" '
    [.[] | (.check_runs // [])[]] as $alle
    | $namen[] as $n
    | ([$alle[] | select(.name == $n)] | sort_by(.id) | last) as $lauf
    | select($lauf == null or $lauf.status != "completed"
        or ($lauf.conclusion != "success" and $lauf.conclusion != "skipped"))
    | "\($n): \(if $lauf == null then "fehlt" else "\($lauf.status)/\($lauf.conclusion)" end)"
  ')" || { echo "FEHLER: Check-Runs nicht lesbar." >&2; exit 2; }
  if [ -n "$fehlend" ]; then
    printf 'Nicht grün am Vorgänger:\n%s\n' "$fehlend" >&2
    return 1
  fi
  return 0
}

case "${1:-}" in
  vorgaenger)
    [ $# -eq 2 ] || { sed -n '4,8p' "$0" >&2; exit 2; }
    vorgaenger "$2" ;;
  gruen)
    [ $# -eq 1 ] || { sed -n '4,8p' "$0" >&2; exit 2; }
    gruen ;;
  checks) printf '%s\n' "${SCHWERE_CHECKS[@]}" ;; # für den Selbsttest
  *) sed -n '4,9p' "$0" >&2; exit 2 ;;
esac
