#!/usr/bin/env bash
# Selbsttest für scripts/wiederholen.sh und scripts/apt-pakete.sh (LFH-1101).
#
# Beide irren still: bricht die Frist einen hängenden Versuch nicht ab, steht der Job wieder bis
# zu seinem Timeout; meldet ein gescheiterter letzter Versuch grün, fehlt nasm erst im
# Rust-Build, an einer Stelle, die nach einem Code-Fehler aussieht. Gefahren gegen Attrappen
# (`sudo`, `dpkg`, `apt-get` im PATH), nie gegen den echten Spiegel.
set -euo pipefail

SKRIPTE="$(cd "$(dirname "$0")" && pwd)"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
export WIEDERHOLEN_PAUSE_SEK=0
fehler=0

ok() { echo "ok   $1"; }
rot() {
  echo "ROT  $1" >&2
  fehler=1
}

# Zählt seine Aufrufe in <zaehler>; hängt in den ersten <haengen> Aufrufen 60 s, gelingt dann
# oder endet mit <rc>.
cat > "$ARBEIT/versuch" <<'EOF'
#!/usr/bin/env bash
zaehler="$1" haengen="$2" rc="$3"
n=$(( $(cat "$zaehler" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "$zaehler"
if [ "$n" -le "$haengen" ]; then sleep 60; fi
exit "$rc"
EOF
chmod +x "$ARBEIT/versuch"

laeuft() { # <name> <erwarteter-rc> <erwartete-versuche> <versuche> <frist> <haengen> <rc>
  local name="$1" soll_rc="$2" soll_n="$3" z="$ARBEIT/zaehler-$RANDOM" rc=0 start dauer
  start=$SECONDS
  "$SKRIPTE/wiederholen.sh" "$4" "$5" -- "$ARBEIT/versuch" "$z" "$6" "$7" \
    > "$ARBEIT/aus" 2>&1 || rc=$?
  dauer=$((SECONDS - start))
  if [ "$rc" -eq "$soll_rc" ] && [ "$(cat "$z")" -eq "$soll_n" ] && [ "$dauer" -lt 20 ]; then
    ok "$name"
  else
    rot "$name: Exit $rc (Soll $soll_rc), $(cat "$z") Versuche (Soll $soll_n), ${dauer} s"
    cat "$ARBEIT/aus" >&2
  fi
}

laeuft "gelingt sofort → ein Versuch, Exit 0" 0 1 3 5 0 0
laeuft "hängt einmal → Frist bricht ab, zweiter Versuch gelingt" 0 2 3 1 1 0
grep -q "Versuch 1 von 3: .* nach 1 s abgebrochen" "$ARBEIT/aus" \
  && ok "  Abbruch wird als Warnung mit Grund gemeldet" \
  || rot "  Warnung zum Abbruch fehlt: $(cat "$ARBEIT/aus")"
laeuft "scheitert immer → Exit des letzten Versuchs nach allen Versuchen" 3 3 3 5 0 3
grep -q "::error::.*3. von 3 Versuchen (Exit 3)" "$ARBEIT/aus" \
  && ok "  letzter Fehlschlag wird als Fehler mit Grund gemeldet" \
  || rot "  Fehlermeldung fehlt: $(cat "$ARBEIT/aus")"
laeuft "hängt immer → Exit 124, nicht bis zum Job-Timeout" 124 2 2 1 9 0

for aufruf in "" "3" "3 5 kommando" "0 5 -- true" "3 x -- true" "3 5 true"; do
  rc=0
  # shellcheck disable=SC2086 # Wortzerlegung ist hier der Testfall.
  "$SKRIPTE/wiederholen.sh" $aufruf > /dev/null 2>&1 || rc=$?
  [ "$rc" -eq 2 ] && ok "falscher Aufruf '$aufruf' → Exit 2" || rot "falscher Aufruf '$aufruf' → Exit $rc"
done

# apt-pakete.sh: Attrappen für sudo, dpkg und apt-get. Das erste `update` hängt; der zweite
# Versuch muss update UND install neu fahren, mit den Paketen als getrennten Argumenten.
ATTRAPPEN="$ARBEIT/bin"
mkdir -p "$ATTRAPPEN"
printf '#!/bin/sh\nexec "$@"\n' > "$ATTRAPPEN/sudo"
printf '#!/bin/sh\nexit 0\n' > "$ATTRAPPEN/dpkg"
cat > "$ATTRAPPEN/apt-get" <<EOF
#!/usr/bin/env bash
echo "\$*" >> "$ARBEIT/apt.log"
if [[ " \$* " == *" update "* ]] && [ ! -e "$ARBEIT/einmal-gehangen" ]; then
  touch "$ARBEIT/einmal-gehangen"
  sleep 60
fi
EOF
chmod +x "$ATTRAPPEN"/*
rc=0
PATH="$ATTRAPPEN:$PATH" APT_FRIST_SEK=1 "$SKRIPTE/apt-pakete.sh" nasm libgtk-3-dev \
  > "$ARBEIT/aus" 2>&1 || rc=$?
erwartet="$(printf '%s\n' \
  "-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 update" \
  "-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 update" \
  "-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 install --no-install-recommends -y nasm libgtk-3-dev")"
if [ "$rc" -eq 0 ] && [ "$(cat "$ARBEIT/apt.log")" = "$erwartet" ]; then
  ok "apt-pakete: hängendes update wird abgebrochen, zweiter Versuch installiert"
else
  rot "apt-pakete: Exit $rc, Aufrufe:"
  cat "$ARBEIT/apt.log" "$ARBEIT/aus" >&2
fi
rc=0
"$SKRIPTE/apt-pakete.sh" > /dev/null 2>&1 || rc=$?
[ "$rc" -eq 2 ] && ok "apt-pakete ohne Paket → Exit 2" || rot "apt-pakete ohne Paket → Exit $rc"

if [ "$fehler" -ne 0 ]; then
  echo "wiederholen.test.sh: ROT" >&2
  exit 1
fi
echo "wiederholen.test.sh: alle Fälle grün"
