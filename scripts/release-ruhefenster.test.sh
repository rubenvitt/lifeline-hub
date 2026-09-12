#!/usr/bin/env bash
# Selbsttest für scripts/release-ruhefenster.sh.
#
# WARUM DIESES GATE ÜBERHAUPT EXISTIERT: die Entscheidung des Skripts ist in BEIDE Richtungen
# still. Tritt es zu oft zurück, entsteht nie wieder ein Release — kein roter Lauf, keine
# Meldung, nur eine Versionsnummer, die stehen bleibt. Tritt es nie zurück, ist der ganze
# Umbau wirkungslos und niemand merkt es, weil das Ergebnis genauso aussieht wie vorher.
# Beide Fehlerbilder fallen erst Tage später auf; ein Test kostet eine Sekunde.
#
# Gefahren wird gegen echte Git-Repositories in einem Temp-Verzeichnis, nicht gegen
# nachgebaute Ausgaben: die Aussagen hängen an `git log`-Bereichen und an Commit-Zeitstempeln,
# und genau da liegen die Fallen (siehe Fall 3 und 6).
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/release-ruhefenster.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

# Ein Repository mit Commits gebauter Altersstufen. `%ct` liest das COMMITTER-Datum, deshalb
# wird beides gesetzt — mit nur GIT_AUTHOR_DATE wären alle Commits sekundenfrisch und die
# Fenster-Hälfte des Tests bewiese nichts.
repo_neu() {
  local pfad="$ARBEIT/$1"
  mkdir -p "$pfad"
  git -C "$pfad" init -q -b alpha
  git -C "$pfad" config user.email test@example.invalid
  git -C "$pfad" config user.name Test
  git -C "$pfad" config commit.gpgsign false
  printf '%s\n' "$pfad"
}

commit() { # <repo> <betreff> <alter-in-sekunden>
  local pfad="$1" betreff="$2" alter="$3" zeit
  zeit="$(( $(date +%s) - alter ))"
  echo "$betreff $RANDOM" >> "$pfad/datei"
  git -C "$pfad" add -A
  GIT_AUTHOR_DATE="$zeit +0000" GIT_COMMITTER_DATE="$zeit +0000" \
    git -C "$pfad" commit -q -m "$betreff"
}

pruefe() { # <name> <erwartet> <gemessen>
  if [ "$2" = "$3" ]; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — erwartet '$2', gemessen '$3'" >&2
    fehler=$((fehler + 1))
  fi
}

lauf() { # <repo> <sha> [env-zuweisungen...] -> gibt freigabe=… aus
  local pfad="$1" sha="$2"; shift 2
  ( cd "$pfad" && env "$@" "$SKRIPT_UNTER_TEST" \
      --branch alpha --sha "$sha" --ref refs/heads/alpha --ohne-fetch 2>/dev/null )
}

echo "==> Ruhefenster-Selbsttest"

# 1 — Der Normalfall: nichts ist nachgekommen, der Commit ist älter als das Fenster.
r="$(repo_neu ruhig)"; commit "$r" "feat: a" 3600
pruefe "ruhiger Kanal released" \
  "freigabe=true" "$(lauf "$r" "$(git -C "$r" rev-parse HEAD)")"

# 2 — Die Sammelwirkung: ein neuerer Merge ist da, dieser Lauf tritt zurück.
r="$(repo_neu ueberholt)"; commit "$r" "feat: a" 3600
sha="$(git -C "$r" rev-parse HEAD)"; commit "$r" "feat: b" 3000
pruefe "neuerer Commit lässt zurücktreten" \
  "freigabe=false" "$(lauf "$r" "$sha")"

# 3 — DIE FALLE: der einzige neuere Commit ist der Versions-Commit des vorherigen Releases.
# Zählte er als „neuer Commit", träte ab dem ersten Release JEDER Lauf zurück und es
# entstünde nie wieder eine Version. Ohne diesen Fall ist das Skript von genau der Bauform,
# die es kaputt macht, nicht zu unterscheiden.
r="$(repo_neu releasecommit)"; commit "$r" "feat: a" 3600
sha="$(git -C "$r" rev-parse HEAD)"
commit "$r" "chore(release): 1.0.0-alpha.9 [skip ci]" 3000
pruefe "Release-Commit zählt nicht als neuer Commit" \
  "freigabe=true" "$(lauf "$r" "$sha")"

# 4 — Das Fenster wirkt: ein frischer Commit hält den Lauf auf, bis die Zeit um ist.
r="$(repo_neu frisch)"; commit "$r" "feat: a" 0
start="$(date +%s)"
aus="$(lauf "$r" "$(git -C "$r" rev-parse HEAD)" RUHEFENSTER_SEK=3 RUHEFENSTER_TAKT_SEK=1)"
dauer=$(( $(date +%s) - start ))
pruefe "frischer Commit wartet das Fenster ab" "freigabe=true" "$aus"
if [ "$dauer" -ge 2 ]; then
  echo "  ok   gewartet wurde tatsächlich (${dauer}s)"
else
  echo "  FEHL es wurde nicht gewartet (${dauer}s bei Fenster 3s)" >&2
  fehler=$((fehler + 1))
fi

# 5 — Gegenprobe zu 4: OHNE Fenster läuft derselbe frische Commit sofort durch. Erst dieses
# Paar belegt, dass die Wartezeit am Fenster hängt und nicht an irgendeiner Trägheit.
r="$(repo_neu ohnefenster)"; commit "$r" "feat: a" 0
start="$(date +%s)"
aus="$(lauf "$r" "$(git -C "$r" rev-parse HEAD)" RUHEFENSTER_SEK=0)"
dauer=$(( $(date +%s) - start ))
pruefe "ohne Fenster kein Warten (Ergebnis)" "freigabe=true" "$aus"
if [ "$dauer" -le 1 ]; then
  echo "  ok   ohne Fenster kein Warten (${dauer}s)"
else
  echo "  FEHL bei Fenster 0 wurde ${dauer}s gewartet" >&2
  fehler=$((fehler + 1))
fi

# 6 — Die zweite Filterstelle: steht ein FRISCHER Release-Commit an der Spitze, darf das
# Fenster nicht auf ihn rechnen. Sonst wartete jeder Lauf nach einem Release das volle
# Fenster auf einen Commit, der selbst aus diesem Release stammt. Fall 3 prüft die
# Bereichs-Zählung, dieser den Zeitstempel — zwei Stellen, zwei Tests.
r="$(repo_neu spitze)"; commit "$r" "feat: a" 3600
sha="$(git -C "$r" rev-parse HEAD)"
commit "$r" "chore(release): 1.0.0-alpha.9 [skip ci]" 0
start="$(date +%s)"
aus="$(lauf "$r" "$sha" RUHEFENSTER_SEK=120 RUHEFENSTER_TAKT_SEK=1)"
dauer=$(( $(date +%s) - start ))
pruefe "frischer Release-Commit bestimmt das Fenster nicht" "freigabe=true" "$aus"
if [ "$dauer" -le 1 ]; then
  echo "  ok   kein Warten auf den Release-Commit (${dauer}s)"
else
  echo "  FEHL auf den Release-Commit wurde ${dauer}s gewartet" >&2
  fehler=$((fehler + 1))
fi

# 7 — Der Deckel entscheidet für das Release, nicht gegen es. Ein hängender Lauf wäre der
# schlechtere Ausgang als ein etwas zu frühes Release.
r="$(repo_neu deckel)"; commit "$r" "feat: a" 0
pruefe "Deckel released statt zu hängen" "freigabe=true" \
  "$(lauf "$r" "$(git -C "$r" rev-parse HEAD)" RUHEFENSTER_SEK=600 RUHEFENSTER_DECKEL_SEK=0)"

echo
if [ "$fehler" -eq 0 ]; then
  echo "==> OK: Ruhefenster-Logik grün."
else
  echo "==> FEHLER: $fehler Zusicherung(en) verletzt." >&2
  exit 1
fi
