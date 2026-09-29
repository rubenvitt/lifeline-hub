#!/usr/bin/env bash
# Ruhefenster vor dem Release — entscheidet, OB dieser Lauf releasen darf. Gewollt ist EINE
# Version je Arbeitsschub, nicht eine je Merge. Die Regel ist zweiteilig:
#
#   1. ÜBERHOLT — liegt auf dem Kanal bereits ein neuerer Commit als der, für den dieser Lauf
#      gestartet ist, tritt er zurück. Der Lauf des neueren Commits macht das Sammel-Release,
#      dessen Notizen unsere Commits enthalten.
#   2. RUHEFENSTER — ist niemand nachgekommen, muss der jüngste Commit trotzdem eine
#      Mindestzeit alt sein; das fängt ein Gate, das schneller ist als der Abstand zwischen
#      zwei Merges. Gewartet wird nur die Differenz zum Fenster, meist also gar nicht.
#
# Kein `cancel-in-progress` auf dem Release-Job: ein Abbruch zwischen dem Push des
# Versions-Commits und dem Anlegen des GitHub-Releases hinterließe ein Tag ohne Release (und
# ohne Binaries, artefakte.yml hängt an `release: published`). Deshalb entscheidet der Lauf
# hier VOR der ersten schreibenden Handlung selbst.
#
# RELEASE-COMMITS ZÄHLEN NICHT ALS „NEUER COMMIT": semantic-release pusht
# `chore(release): <version> [skip ci]` auf denselben Kanal, der danach HEAD ist. Ein naiver
# Vergleich „HEAD == mein Commit?" ließe jeden folgenden Lauf zurücktreten — es entstünde nie
# wieder ein Release. Gefiltert wird am Betreff-Präfix (das `message`-Feld in
# release.config.mjs), nicht am konfigurierbaren Autor.
#
# Nebeneffekt: ein Release gegen einen weitergewanderten Kanal scheiterte sonst erst beim Push
# (non-fast-forward), nach Changelog und Versions-Bump.
#
# AUFRUF (die CI ruft nur das hier):
#   scripts/release-ruhefenster.sh --branch alpha --sha "$GITHUB_SHA"
# Ergebnis auf stdout als `freigabe=true|false`, zusätzlich nach $GITHUB_OUTPUT, wenn gesetzt.
# Exit-Code 0 in beiden Fällen — „ich trete zurück" ist kein Fehler.
set -euo pipefail

# 15 Minuten, am Gate ausgerichtet (der Push-Lauf von ci.yml braucht rund 14 Minuten): ein
# kürzeres Fenster wäre beim Erreichen dieses Skripts immer schon abgelaufen, ein längeres
# verschöbe jedes Release um Leerlauf.
FENSTER_SEK="${RUHEFENSTER_SEK:-900}"
# Obergrenze für die Summe aller Wartezeiten (gegen eine versehentlich große Fenster-Angabe
# oder eine nachgehende Uhr). Wird sie erreicht, wird RELEASED — ein fehlendes Release ist
# teurer als ein zu frühes.
DECKEL_SEK="${RUHEFENSTER_DECKEL_SEK:-1800}"
# Länge eines Schlafs, kürzer als das Fenster: ein während des Wartens eintreffender Commit
# löst den Rücktritt so noch aus.
TAKT_SEK="${RUHEFENSTER_TAKT_SEK:-60}"

# Muss zum `message` von @semantic-release/git in release.config.mjs passen.
RELEASE_PRAEFIX="chore(release): "

BRANCH=""
SHA=""
REF=""
OHNE_FETCH=0

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --sha)    SHA="${2:-}";    shift 2 ;;
    # Nur für den Selbsttest: dort gibt es kein `origin`, geprüft wird gegen eine lokale Ref.
    --ref)    REF="${2:-}";    shift 2 ;;
    --ohne-fetch) OHNE_FETCH=1; shift ;;
    *) echo "FEHLER: unbekanntes Argument '$1'." >&2; exit 2 ;;
  esac
done

[ -n "$BRANCH" ] || { echo "FEHLER: --branch fehlt." >&2; exit 2; }
[ -n "$SHA" ]    || { echo "FEHLER: --sha fehlt." >&2; exit 2; }
REF="${REF:-origin/$BRANCH}"

jetzt() { date +%s; }

# Der Stand des Kanals, frisch vom Remote. Explizite Refspec: actions/checkout steht auf einem
# losgelösten HEAD, nur so ist `refs/remotes/origin/<branch>` danach sicher vorhanden.
kanal_holen() {
  [ "$OHNE_FETCH" -eq 1 ] && return 0
  git fetch --quiet origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
}

# Anzahl der Commits, die auf dem Kanal NACH unserem Stand liegen, Release-Commits
# ausgenommen. awk statt grep: grep endet bei null Treffern mit 1, unter `set -e` ein Fehler.
neuere_commits() {
  # Bewusst OHNE `2>/dev/null`: scheitert das Kommando hier, soll der Lauf laut rot werden —
  # still auf 0 zu fallen hieße releasen, obwohl die Grundlage der Entscheidung fehlt.
  git log --format=%s "$SHA..$REF" |
    awk -v p="$RELEASE_PRAEFIX" 'index($0, p) != 1 { n++ } END { print n + 0 }'
}

# Zeitstempel des jüngsten NICHT-Release-Commits: stünde ein frischer Release-Commit an der
# Spitze, wartete die Rechnung sonst das volle Fenster auf ihn.
letzter_commit_ts() {
  local ts
  ts="$(git log --format='%ct%x09%s' "$REF" |
    awk -F'\t' -v p="$RELEASE_PRAEFIX" 'index($2, p) != 1 { print $1; exit }')"
  [ -n "$ts" ] || ts="$(git log -1 --format=%ct "$REF")"
  printf '%s\n' "$ts"
}

ergebnis() {
  echo "freigabe=$1"
  [ -z "${GITHUB_OUTPUT:-}" ] || echo "freigabe=$1" >> "$GITHUB_OUTPUT"
  exit 0
}

frist=$(( $(jetzt) + DECKEL_SEK ))

while :; do
  kanal_holen

  neuere="$(neuere_commits)"
  if [ "$neuere" -gt 0 ]; then
    echo "Zurückgetreten: auf '$BRANCH' liegen $neuere neuere Commits als $SHA." >&2
    echo "Deren Lauf erstellt das Release; unsere Commits sind in dessen Notizen enthalten." >&2
    ergebnis false
  fi

  alter=$(( $(jetzt) - $(letzter_commit_ts) ))
  if [ "$alter" -ge "$FENSTER_SEK" ]; then
    echo "Freigabe: jüngster Commit auf '$BRANCH' ist ${alter}s alt (Ruhefenster ${FENSTER_SEK}s)." >&2
    ergebnis true
  fi

  rest=$(( FENSTER_SEK - alter ))
  if [ "$(jetzt)" -ge "$frist" ]; then
    echo "WARNUNG: Deckel von ${DECKEL_SEK}s erreicht, Ruhefenster noch ${rest}s offen." >&2
    echo "         Es wird trotzdem released — ein fehlendes Release wiegt schwerer." >&2
    echo "         Wenn das öfter vorkommt, stimmt RUHEFENSTER_SEK nicht zur Gate-Dauer." >&2
    ergebnis true
  fi

  schlaf="$TAKT_SEK"
  [ "$rest" -lt "$schlaf" ] && schlaf="$rest"
  [ "$schlaf" -lt 1 ] && schlaf=1
  echo "Warte ${schlaf}s — jüngster Commit ist ${alter}s alt, Ruhefenster ${FENSTER_SEK}s." >&2
  sleep "$schlaf"
done
