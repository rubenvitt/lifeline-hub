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
#   (c) mindestens eine Migration unverändert umbenennt (R100, `migrations/*` nach
#       `migrations/*`) und
#   (d) daneben nur Dateien ändert, die laut `bereiche.sh` keine schwere Suite liest (der Autofix
#       zieht Verweise auf den Dateinamen mit, etwa im Glossar),
# höchstens SCHRITTE_MAX Commits weit. Ausgegeben wird der erste Commit, der das nicht erfüllt.
# Entschieden wird am INHALT, nicht am Autor: wer den Trailer fälscht, bringt damit nur eine
# inhaltsgleiche Umbenennung und Doku durch, und eine umbenannte Bestandsmigration macht
# `Migrationsnummern` rot. Zieht der Autofix einen Verweis in Code mit (`include_str!`), liest
# den eine Suite: dann läuft alles. Im Zweifel wird geprüft.
#
# Was dabei ungeprüft bleibt, prüft auch sonst kein PR-Lauf: das Zusammenspiel mit dem, was auf
# dem Ziel-Branch inzwischen dazukam. Das fängt der Push-Lauf auf dem Ziel-Branch.
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

# Ist <commit> eine reine Umnummerierung des Autofix?
ist_umnummerierung() {
  local c="$1" trailer eltern zeilen status alt neu
  trailer="$(git log -1 --format="%(trailers:key=$TRAILER_SCHLUESSEL,valueonly)" "$c")"
  [ -n "$trailer" ] || return 1
  eltern="$(git rev-list --parents -n 1 "$c" | wc -w | tr -d ' ')"
  [ "$eltern" = 2 ] || return 1 # der Commit selbst plus genau ein Elternteil
  zeilen="$(git diff-tree -r --no-commit-id --find-renames=100% --name-status "$c^" "$c")"
  [ -n "$zeilen" ] || return 1
  local umbenannt=0 andere=""
  while IFS=$'\t' read -r status alt neu; do
    if [ "$status" = R100 ] && ist_migration "$alt" && ist_migration "$neu"; then
      umbenannt=$((umbenannt + 1))
      continue
    fi
    # Alles andere, auch eine Migration, die nicht unverändert umbenannt wurde: `bereiche.sh`
    # entscheidet. `migrations/*` fordert dort die Rust-Suite, also läuft dann alles.
    andere="$andere$alt"$'\n'
    [ -n "$neu" ] && andere="$andere$neu"$'\n'
  done <<< "$zeilen"
  [ "$umbenannt" -gt 0 ] || return 1
  if [ -n "$andere" ]; then
    printf '%s' "$andere" | "$SKRIPTE/bereiche.sh" | grep -q '=true' && return 1
  fi
  return 0
}

ist_migration() {
  case "$1" in migrations/*/*) return 1 ;; migrations/*) return 0 ;; *) return 1 ;; esac
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
