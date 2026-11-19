#!/usr/bin/env bash
# OpenSpec ist seit 18.11.2026 eingefrorenes Archiv (LLH-1967, ADR-0065): geplant wird mit
# Superpowers, Entwürfe und Pläne liegen unter `docs/superpowers/`. `openspec/changes/archive/`
# und `openspec/specs/` bleiben lesbar, weil Code, ADRs und Migrationen auf sie verweisen.
# Regeln: Wurzel-`AGENTS.md`, „Planung und Ausführung — Superpowers“.
#
# Rot ist, was einen zweiten Planungsort wieder aufmachte:
# - ein Eintrag unter `openspec/changes/` außer `archive/` (eine neue Change),
# - `openspec/config.yaml` (das OpenSpec-CLI arbeitete wieder),
# - `.claude/commands/opsx/` oder ein Skill `.claude/skills/openspec-*`.
#
# Abhilfe: Planung über superpowers:brainstorming und superpowers:writing-plans, Ablage
# `docs/superpowers/specs/` und `docs/superpowers/plans/`.
#
# Aufruf: scripts/check-openspec-eingefroren.sh [<repo-wurzel>]   (Selbsttest: *.test.sh daneben)
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
funde=()

if [ -d "$ROOT/openspec/changes" ]; then
  for eintrag in "$ROOT/openspec/changes"/*; do
    [ -e "$eintrag" ] || continue
    name="$(basename "$eintrag")"
    [ "$name" = archive ] && continue
    funde+=("openspec/changes/$name")
  done
fi
[ -e "$ROOT/openspec/config.yaml" ] && funde+=("openspec/config.yaml")
[ -e "$ROOT/.claude/commands/opsx" ] && funde+=(".claude/commands/opsx")
for skill in "$ROOT/.claude/skills"/openspec-*; do
  [ -e "$skill" ] || continue
  funde+=(".claude/skills/$(basename "$skill")")
done

if [ "${#funde[@]}" -gt 0 ]; then
  echo "FEHLER: OpenSpec ist eingefrorenes Archiv, aber hier lebt es wieder:" >&2
  printf '         %s\n' "${funde[@]}" >&2
  echo "       Planung über superpowers:brainstorming und superpowers:writing-plans," >&2
  echo "       Ablage docs/superpowers/specs/ und docs/superpowers/plans/ (AGENTS.md, ADR-0065)." >&2
  exit 1
fi
echo "OK: OpenSpec bleibt eingefrorenes Archiv."
