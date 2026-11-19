#!/usr/bin/env bash
# Selbsttest für scripts/check-openspec-eingefroren.sh. Der Wächter irrt in beide Richtungen still:
# ließe er eine neue Change oder das OpenSpec-Werkzeug durch, wüchse neben `docs/superpowers/` ein
# zweiter Planungsort heran; schlüge er auf das Archiv an, würde er abgeschaltet.
#
# Gefahren gegen einen Miniaturbaum im Temp-Verzeichnis, je Fall frisch aufgebaut.
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/check-openspec-eingefroren.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

baum_neu() { # <name> → Pfad eines grünen Baums: Archiv, Specs, Superpowers-Ablage, eigene Skills
  local b="$ARBEIT/$1"
  mkdir -p "$b/openspec/changes/archive/2026-01-01-lfh-0-alt" "$b/openspec/specs/x" \
    "$b/docs/superpowers/plans" "$b/.claude/skills/dev-zunder-ausfuehren" "$b/.claude/commands"
  printf '# Tasks\n\n- [x] 1.1 fertig\n' > "$b/openspec/changes/archive/2026-01-01-lfh-0-alt/tasks.md"
  printf '# Spec\n' > "$b/openspec/specs/x/spec.md"
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

echo "==> Selbsttest check-openspec-eingefroren.sh"
fall "nur Archiv und Specs" gruen ":"
fall "kein openspec/ im Baum" gruen "rm -rf openspec"
fall "neue aktive Change" rot "mkdir openspec/changes/lfh-9-neu" "openspec/changes/lfh-9-neu"
fall "Datei direkt unter changes/" rot "printf x > openspec/changes/notiz.md" "openspec/changes/notiz.md"
fall "config.yaml zurück" rot "printf 'schema: spec-driven\n' > openspec/config.yaml" "openspec/config.yaml"
fall "opsx-Befehle zurück" rot "mkdir .claude/commands/opsx" "\.claude/commands/opsx"
fall "openspec-Skill zurück" rot "mkdir .claude/skills/openspec-propose" "openspec-propose"
fall "Change und Befehle zugleich: der Wächter hört nicht nach der ersten auf" rot \
  "mkdir openspec/changes/lfh-9-neu .claude/commands/opsx" "\.claude/commands/opsx"

if [ "$fehler" -gt 0 ]; then
  echo "==> $fehler Fall/Fälle falsch." >&2
  exit 1
fi
echo "==> OK: der Wächter trennt alle Fälle."
