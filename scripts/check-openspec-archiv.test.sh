#!/usr/bin/env bash
# Selbsttest für scripts/check-openspec-archiv.sh. Der Wächter irrt in beide Richtungen still:
# ließe er eine fertige Change durch, blieben wieder zwölf Changes liegen und ihre Specs
# unsynchronisiert (Stand 30.09.2026); schlüge er auf eine laufende Change an, würde er
# abgeschaltet.
#
# Gefahren gegen einen Miniaturbaum im Temp-Verzeichnis, je Fall frisch aufgebaut.
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/check-openspec-archiv.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

baum_neu() { # <name> → Pfad eines grünen Baums: eine laufende Change, eine archivierte
  local b="$ARBEIT/$1"
  mkdir -p "$b/openspec/changes/lfh-1-laeuft" "$b/openspec/changes/archive/2026-01-01-lfh-0-alt"
  printf '# Tasks\n\n- [x] 1.1 fertig\n- [ ] 1.2 offen\n' > "$b/openspec/changes/lfh-1-laeuft/tasks.md"
  printf '# Tasks\n\n- [x] 1.1 fertig\n' > "$b/openspec/changes/archive/2026-01-01-lfh-0-alt/tasks.md"
  printf '%s\n' "$b"
}

fall() { # <name> <erwartet: gruen|rot> <befehl, der den Baum $B verändert> [<muster in der Ausgabe>]
  local B
  B="$(baum_neu "$(printf '%s' "$1" | tr -c '[:alnum:]' '_')")"
  (cd "$B" && eval "$3")
  local ist=gruen
  "$SKRIPT_UNTER_TEST" "$B" > "$ARBEIT/ausgabe" 2>&1 || ist=rot
  if [ "$ist" != "$2" ]; then
    echo "  FEHL $1 — erwartet $2, gemessen $ist:" >&2
    sed 's/^/         /' "$ARBEIT/ausgabe" >&2
    fehler=$((fehler + 1))
  elif [ -n "${4:-}" ] && ! grep -qE -- "$4" "$ARBEIT/ausgabe"; then
    echo "  FEHL $1 — '$4' fehlt in der Ausgabe:" >&2
    sed 's/^/         /' "$ARBEIT/ausgabe" >&2
    fehler=$((fehler + 1))
  else
    echo "  ok   $1"
  fi
}

C=openspec/changes
echo "==> Selbsttest check-openspec-archiv.sh"
fall "laufende Change, archivierte daneben" gruen ":"
fall "alle Aufgaben erledigt, nicht archiviert" rot \
  "sed -i.bak 's/- \[ \] 1.2/- [x] 1.2/' $C/lfh-1-laeuft/tasks.md && rm $C/lfh-1-laeuft/tasks.md.bak" \
  "lfh-1-laeuft"
fall "großes X und Leerraum in der Klammer zählen als erledigt" rot \
  "printf -- '- [X] 1.1 a\n  - [ x ] 1.2 b\n' > $C/lfh-1-laeuft/tasks.md"
fall "unbekannte Marke [~] zählt als offen" gruen \
  "printf -- '- [x] 1.1 a\n- [~] 1.2 b\n' > $C/lfh-1-laeuft/tasks.md"
fall "leere Klammer [] zählt als offen" gruen \
  "printf -- '- [x] 1.1 a\n- [] 1.2 b\n' > $C/lfh-1-laeuft/tasks.md"
fall "Change ohne tasks.md (noch in Planung)" gruen "rm $C/lfh-1-laeuft/tasks.md"
fall "tasks.md ohne ein einziges Kästchen" gruen "printf '# Tasks\n\nnoch leer\n' > $C/lfh-1-laeuft/tasks.md"
fall "keine laufende Change" gruen "rm -rf $C/lfh-1-laeuft"
fall "kein openspec/ im Baum" gruen "rm -rf openspec"
fall "eine von zwei fertig: nur die fertige wird genannt" rot \
  "mkdir $C/lfh-2-fertig && printf -- '- [x] 1.1 a\n' > $C/lfh-2-fertig/tasks.md" \
  "lfh-2-fertig"

if [ "$fehler" -gt 0 ]; then
  echo "==> $fehler Fall/Fälle falsch." >&2
  exit 1
fi
echo "==> OK: der Wächter trennt alle Fälle."
