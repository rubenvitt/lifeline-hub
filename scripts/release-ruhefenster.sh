#!/usr/bin/env bash
# Ruhefenster vor dem Release — entscheidet, OB dieser Lauf releasen darf.
#
# DAS PROBLEM, DAS ES LÖST: bis hierher hing `release` als `needs`-Job an jedem grünen
# Push-Lauf von ci.yml. Jeder gemergte Pull Request erzeugte damit sein eigenes Release —
# bei drei Merges kurz hintereinander drei Vorabversionen, deren Notizen je eine Handvoll
# Commits tragen. Gewollt ist EINE Version je Arbeitsschub, nicht eine je Merge.
#
# DIE REGEL IST BEWUSST NICHT „WARTE X MINUTEN", SONDERN ZWEITEILIG:
#
#   1. ÜBERHOLT — liegt auf dem Kanal bereits ein neuerer Commit als der, für den dieser
#      Lauf gestartet ist, tut dieser Lauf gar nichts. Der Lauf des neueren Commits macht
#      das eine Sammel-Release, und dessen Notizen enthalten unsere Commits mit. Das ist
#      die Hälfte, die bei schnellen Merges wirkt: n Merges innerhalb einer Gate-Dauer
#      ergeben 1 Release statt n.
#   2. RUHEFENSTER — ist niemand nachgekommen, muss der jüngste Commit trotzdem eine
#      Mindestzeit alt sein. Das fängt den Fall, in dem das Gate SCHNELLER ist als der
#      Abstand zwischen zwei Merges: ohne diese Hälfte releaste ein Lauf, der nach acht
#      Minuten grün ist, bevor der Merge zwei Minuten später überhaupt sichtbar wird.
#      Gewartet wird nur die DIFFERENZ zum Fenster — das Gate hat die Zeit meist schon
#      verbraucht, der Regelfall ist also gar keine Wartezeit.
#
# WARUM NICHT `cancel-in-progress` AUF DEM RELEASE-JOB: ein Abbruch träfe den Lauf
# möglicherweise ZWISCHEN dem Push des Versions-Commits und dem Anlegen des GitHub-Releases.
# Zurück bliebe ein Tag ohne Release, und weil artefakte.yml an `release: published` hängt,
# entstünden für dieses Tag nie Binaries — kein roter Lauf, nur ein fehlendes Release. Die
# Begründung steht ausführlich im Nebenläufigkeits-Kommentar von ci.yml. Deshalb entscheidet
# ein Lauf hier VOR der ersten schreibenden Handlung selbst, ob er zurücktritt.
#
# RELEASE-COMMITS ZÄHLEN NICHT ALS „NEUER COMMIT", und das ist kein Detail, sondern der
# Unterschied zwischen „sammelt" und „released nie wieder": semantic-release pusht
# `chore(release): <version> [skip ci]` auf denselben Kanal. Dieser Commit IST danach
# HEAD. Ein naiver Vergleich „HEAD == mein Commit?" wäre für jeden folgenden Lauf falsch —
# er sähe immer einen neueren Commit, träte immer zurück, und es entstünde kein Release
# mehr. Gefiltert wird am Betreff-Präfix, nicht am Autor: der Autor ist über
# GIT_AUTHOR_NAME konfigurierbar, das Präfix steht in release.config.mjs im
# `message`-Feld von @semantic-release/git und ist dieselbe Zeichenkette, die den Tag
# erzeugt.
#
# NEBENEFFEKT, DER EINEN BESTEHENDEN FEHLERFALL SCHLIESST: läuft ein Release, während der
# Kanal schon weitergewandert ist, scheitert der Push von @semantic-release/git als
# non-fast-forward — und zwar NACH Changelog und Versions-Bump, also an der teuren Stelle.
# Genau diese Lage ist jetzt die Abbruchbedingung 1, und sie kostet nichts.
#
# AUFRUF (die CI ruft nur das hier, sie stellt sich nichts selbst zusammen):
#   scripts/release-ruhefenster.sh --branch alpha --sha "$GITHUB_SHA"
# Ergebnis auf stdout als `freigabe=true|false`, zusätzlich nach $GITHUB_OUTPUT, wenn gesetzt.
# Exit-Code 0 in beiden Fällen — „ich trete zurück" ist kein Fehler; ein roter Lauf wäre
# hier die falsche Aussage und würde als kaputte Pipeline gelesen.
set -euo pipefail

# 15 Minuten. Die Zahl ist am Gate ausgerichtet, nicht geraten: der Push-Lauf von ci.yml
# braucht gemessen rund 14 Minuten (grüner Lauf 34636145213, warme Caches). Ein Fenster
# darunter wäre wirkungslos — es wäre beim Erreichen dieses Skripts immer schon abgelaufen.
# Ein deutlich größeres verschöbe jedes Release um Leerlauf, den niemand nutzt. Praktisch
# wartet dieser Schritt damit selten mehr als ein bis zwei Minuten.
FENSTER_SEK="${RUHEFENSTER_SEK:-900}"
# Obergrenze für die Summe aller Wartezeiten. Sie schützt gegen zwei Fälle, in denen die
# Rechnung oben nicht terminiert: eine versehentlich sehr große Fenster-Angabe und eine
# Uhr, die dem Commit-Zeitstempel hinterherläuft. Wird sie erreicht, wird RELEASED, nicht
# abgebrochen — ein fehlendes Release ist der teurere Ausgang als ein zu frühes.
DECKEL_SEK="${RUHEFENSTER_DECKEL_SEK:-1800}"
# Länge eines Schlafs. Kürzer als das Fenster, damit ein Commit, der während des Wartens
# eintrifft, den Rücktritt noch auslöst, statt erst nach dem vollen Fenster gesehen zu werden.
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

# Der Stand des Kanals, frisch vom Remote. Die explizite Refspec statt eines nackten
# `git fetch origin "$BRANCH"`: actions/checkout steht auf einem losgelösten HEAD, und nur
# mit der Refspec ist `refs/remotes/origin/<branch>` danach sicher vorhanden.
kanal_holen() {
  [ "$OHNE_FETCH" -eq 1 ] && return 0
  git fetch --quiet origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
}

# Anzahl der Commits, die auf dem Kanal NACH unserem Stand liegen — Release-Commits
# ausgenommen (Begründung im Kopf). awk statt grep, weil grep bei null Treffern mit 1
# endet und das unter `set -e` als Fehler durchschlüge.
neuere_commits() {
  # Bewusst OHNE `2>/dev/null`: scheitert git hier (fehlende Ref, kaputter Checkout), soll
  # der Lauf laut rot werden. `set -o pipefail` trägt den Fehlschlag aus der Pipe heraus.
  # Still auf 0 zu fallen hieße „niemand ist nachgekommen" — also releasen, obwohl die
  # Grundlage der Entscheidung fehlt.
  git log --format=%s "$SHA..$REF" |
    awk -v p="$RELEASE_PRAEFIX" 'index($0, p) != 1 { n++ } END { print n + 0 }'
}

# Zeitstempel des jüngsten NICHT-Release-Commits auf dem Kanal. Auch hier ist die Filterung
# tragend: stünde ein frischer Release-Commit an der Spitze, wartete die Rechnung sonst das
# volle Fenster auf einen Commit, der selbst aus dem letzten Release stammt.
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
