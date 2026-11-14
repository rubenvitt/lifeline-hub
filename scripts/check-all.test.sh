#!/usr/bin/env bash
# Selbsttest für scripts/lib/schritte.sh, den Schrittläufer des Sammel-Gates (LFH-386).
#
# Der Läufer irrt in beide Richtungen still: bricht er beim ersten roten Schritt ab, laufen die
# Schritte dahinter nie (so fielen Advisories und e2e aus dem Vollauf, solange Vitest rot war);
# verliert er dabei `set -e` innerhalb eines Schritts, meldet ein Schritt grün, dessen erstes
# Kommando scheiterte. Gefahren mit Attrappen-Schritten statt der echten Suiten.
set -euo pipefail

LIB="$(cd "$(dirname "$0")" && pwd)/lib/schritte.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

# Fährt <schritte…> mit den Attrappen aus <definitionen> in einer frischen Shell unter
# `set -euo pipefail`, wie check-all.sh. Ausgabe nach $ARBEIT/aus, Exit-Code als Rückgabe.
fahren() { # <definitionen> <abbrechen:0|1> <schritte…>
  local defs="$1" abbrechen="$2"
  shift 2
  set +e
  bash -c '
    set -euo pipefail
    . "$1"
    eval "$2"
    SCHRITTE=9
    abbrechen="$3"
    shift 3
    schritte_fahren "$abbrechen" "$@"
    schritte_bericht
  ' _ "$LIB" "$defs" "$abbrechen" "$@" > "$ARBEIT/aus" 2>&1
  local rc=$?
  set -e
  return "$rc"
}

pruefe() { # <name> <soll-exit> <ist-exit>
  if [ "$2" = "$3" ]; then
    echo "ok   $1"
  else
    echo "FAIL $1: Exit $3, erwartet $2" >&2
    sed 's/^/     | /' "$ARBEIT/aus" >&2
    fehler=1
  fi
}

enthaelt() { # <name> <muster>
  if grep -qE -- "$2" "$ARBEIT/aus"; then
    echo "ok   $1"
  else
    echo "FAIL $1: '$2' fehlt in der Ausgabe" >&2
    sed 's/^/     | /' "$ARBEIT/aus" >&2
    fehler=1
  fi
}

fehlt() { # <name> <muster>
  if grep -qE -- "$2" "$ARBEIT/aus"; then
    echo "FAIL $1: '$2' steht in der Ausgabe" >&2
    sed 's/^/     | /' "$ARBEIT/aus" >&2
    fehler=1
  else
    echo "ok   $1"
  fi
}

GRUEN='schritt_1() { echo lief-1; }; schritt_2() { echo lief-2; }'

# 1 — alles grün: Exit 0, Gesamtstatus grün.
rc=0; fahren "$GRUEN" 0 1 2 || rc=$?
pruefe "1 alles grün → Exit 0" 0 "$rc"
enthaelt "1 Gesamtstatus nennt grün" '^==> OK'

# 2 — der Kern von LFH-386: ein roter Schritt hält die folgenden NICHT auf.
rc=0; fahren 'schritt_1() { echo lief-1; false; }; schritt_2() { echo lief-2; }' 0 1 2 || rc=$?
pruefe "2 roter Schritt → Exit 1" 1 "$rc"
enthaelt "2 Schritt 2 läuft nach rotem Schritt 1" '^lief-2$'
enthaelt "2 Bericht nennt Schritt 1 rot" '\[1/9\] +ROT'
enthaelt "2 Bericht nennt Schritt 2 grün" '\[2/9\] +grün'
enthaelt "2 Schlusszeile rot" '^==> ROT'

# 3 — `set -e` gilt INNERHALB eines Schritts weiter: das erste scheiternde Kommando beendet
# ihn, das zweite läuft nicht und überschreibt den Status nicht mit grün. (Die Falle: ein
# Funktionsaufruf in `if`/`||` schaltet errexit für den ganzen Körper ab.)
rc=0; fahren 'schritt_1() { false; echo zweites-kommando; }' 0 1 || rc=$?
pruefe "3 erstes Kommando rot → Schritt rot" 1 "$rc"
fehlt "3 zweites Kommando läuft nicht" '^zweites-kommando$'

# 4 — pipefail gilt im Schritt.
rc=0; fahren 'schritt_1() { false | true; }' 0 1 || rc=$?
pruefe "4 rote Pipe-Stufe → Schritt rot" 1 "$rc"

# 5 — `exit` im Schritt beendet nur den Schritt.
rc=0; fahren 'schritt_1() { exit 3; }; schritt_2() { echo lief-2; }' 0 1 2 || rc=$?
pruefe "5 exit im Schritt → Exit 1" 1 "$rc"
enthaelt "5 Läufer überlebt exit, Schritt 2 läuft" '^lief-2$'
enthaelt "5 Bericht nennt den Exit-Code" '\[1/9\] +ROT \(Exit 3\)'

# 6 — übersprungen ist weder grün noch rot: Exit 0, aber ausdrücklich als Lücke benannt.
rc=0; fahren 'schritt_1() { return "$UEBERSPRUNGEN_RC"; }; schritt_2() { :; }' 0 1 2 || rc=$?
pruefe "6 übersprungen → Exit 0" 0 "$rc"
enthaelt "6 Bericht nennt übersprungen" '\[1/9\] +übersprungen'
enthaelt "6 Schlusszeile nennt die Lücke" '^==> OK mit Lücke'
fehlt "6 kein vorbehaltloses OK" '^==> OK: '

# 7 — --abbrechen: nach dem ersten roten Schritt läuft keiner mehr, und der Bericht sagt es.
rc=0; fahren 'schritt_1() { false; }; schritt_2() { echo lief-2; }' 1 1 2 || rc=$?
pruefe "7 abbrechen → Exit 1" 1 "$rc"
fehlt "7 Schritt 2 läuft nach Abbruch nicht" '^lief-2$'
enthaelt "7 Bericht nennt Schritt 2 nicht gelaufen" '\[2/9\] +nicht gelaufen'

# 8 — rot schlägt übersprungen: ein roter und ein übersprungener Schritt ergeben rot.
rc=0; fahren 'schritt_1() { return "$UEBERSPRUNGEN_RC"; }; schritt_2() { false; }' 0 1 2 || rc=$?
pruefe "8 rot + übersprungen → Exit 1" 1 "$rc"
enthaelt "8 Schlusszeile rot" '^==> ROT'

# 9 — die Meldung eines roten Schritts steht sofort da, nicht erst im Schlussbericht: wer den
# Vollauf abbrechen will, sieht den Grund, bevor die nächste Suite startet.
rc=0; fahren 'schritt_1() { false; }; schritt_2() { echo lief-2; }' 0 1 2 || rc=$?
if [ "$(grep -nE '^==> Schritt 1 ROT' "$ARBEIT/aus" | cut -d: -f1)" \
  -lt "$(grep -n '^lief-2$' "$ARBEIT/aus" | cut -d: -f1)" ] 2> /dev/null; then
  echo "ok   9 rote Meldung steht vor dem nächsten Schritt"
else
  echo "FAIL 9 rote Meldung fehlt oder steht erst nach dem nächsten Schritt" >&2
  sed 's/^/     | /' "$ARBEIT/aus" >&2
  fehler=1
fi

# Bündel `baut` (LLH-1849): der Kompilierlauf des Checks „Baut mit Ziel-Branch“. Er fährt NUR den
# Kompilierschritt, und der volle Lauf fährt ihn nicht mit (Schritt 3, 4 und 15 bauen dasselbe
# samt Tests). Fehlte er im Skript, fiele der Pflicht-Check mit „unbekanntes Bündel“ rot aus.
CHECK_ALL="$(cd "$(dirname "$0")" && pwd)/check-all.sh"
rc=0; "$CHECK_ALL" --nur baut --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
pruefe "10 Bündel baut ist bekannt" 0 "$rc"
enthaelt "10 Bündel baut fährt nur den Kompilierschritt" '^Schritte: 17$'
rc=0; "$CHECK_ALL" --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
pruefe "11 voller Lauf wählt aus" 0 "$rc"
fehlt "11 voller Lauf fährt den Kompilierschritt nicht mit" '^Schritte: .*\b17\b'
enthaelt "11 voller Lauf fährt die e2e-Suite" '^Schritte: .*\b7\b'

# 13 — `--ohne-e2e` (LLH-1889): Agenten fahren vor dem PR die betroffenen Suiten lokal, aber ohne
# e2e; die läuft auf alpha. Fehlte die Option, liefe lokal eine Stunde Playwright mit.
rc=0; "$CHECK_ALL" --ohne-e2e --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
pruefe "13 --ohne-e2e ist bekannt" 0 "$rc"
fehlt "13 --ohne-e2e lässt Schritt 7 aus" '^Schritte: .*\b7\b'
enthaelt "13 --ohne-e2e fährt den Rest" '^Schritte: 1 2 3 4 5 6 8 '
rc=0; "$CHECK_ALL" --geaendert=HEAD --ohne-e2e --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
pruefe "13 --ohne-e2e geht mit --geaendert" 0 "$rc"
fehlt "13 --geaendert --ohne-e2e lässt Schritt 7 aus" '^Schritte: .*\b7\b'
rc=0; "$CHECK_ALL" --nur e2e --ohne-e2e --auswahl > "$ARBEIT/aus" 2>&1 || rc=$?
pruefe "13 --nur e2e mit --ohne-e2e ist ein Widerspruch" 2 "$rc"

# 12 — Schritt 6 fährt Advisory-Scan UND Karenz-Prüfung, auch wenn der Scan rot ist (LLH-1884):
# sonst käme ein zu junges Paket neben einem Advisory erst im nächsten Lauf ans Licht. Gefahren
# wird der echte Schritt aus check-all.sh gegen Attrappen der beiden Skripte.
mkdir -p "$ARBEIT/s6/scripts"
printf '#!/bin/sh\necho deps-rot; exit 1\n' > "$ARBEIT/s6/scripts/check-deps.sh"
printf '#!/bin/sh\necho karenz-lief; exit 0\n' > "$ARBEIT/s6/scripts/check-karenzzeit.sh"
chmod +x "$ARBEIT/s6/scripts/"*.sh
schritt_6_def="$(sed -n '/^schritt_6() {/,/^}/p' "$CHECK_ALL")"
rc=0; fahren "ROOT='$ARBEIT/s6'; $schritt_6_def" 0 6 || rc=$?
pruefe "12 Schritt 6 bleibt rot, wenn der Advisory-Scan rot ist" 1 "$rc"
enthaelt "12 Schritt 6 fährt die Karenz-Prüfung trotz rotem Scan" '^karenz-lief$'
# Gegenrichtung: ein Karenz-Verstoß bei grünem Scan macht Schritt 6 rot; ein verschluckter
# Exit-Code der Karenz-Prüfung bliebe sonst von Fall 12 unbemerkt.
printf '#!/bin/sh\necho deps-gruen; exit 0\n' > "$ARBEIT/s6/scripts/check-deps.sh"
printf '#!/bin/sh\necho karenz-rot; exit 1\n' > "$ARBEIT/s6/scripts/check-karenzzeit.sh"
rc=0; fahren "ROOT='$ARBEIT/s6'; $schritt_6_def" 0 6 || rc=$?
pruefe "12b Karenz-Verstoß bei grünem Scan macht Schritt 6 rot" 1 "$rc"
printf '#!/bin/sh\necho deps-rot; exit 1\n' > "$ARBEIT/s6/scripts/check-deps.sh"
rc=0; fahren "ROOT='$ARBEIT/s6'; $schritt_6_def" 0 6 || rc=$?
pruefe "12c beide rot: Schritt 6 rot" 1 "$rc"
enthaelt "12c beide rot: die Karenz-Prüfung lief" '^karenz-rot$'

if [ "$fehler" -ne 0 ]; then
  echo "check-all.test.sh: ROT" >&2
  exit 1
fi
echo "check-all.test.sh: alle Fälle grün"
