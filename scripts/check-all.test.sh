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

# 5 — `exit` im Schritt (schritt_7 bei nicht ausführbarem PW_BINAER) beendet nur den Schritt.
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

if [ "$fehler" -ne 0 ]; then
  echo "check-all.test.sh: ROT" >&2
  exit 1
fi
echo "check-all.test.sh: alle Fälle grün"
