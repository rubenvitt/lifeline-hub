#!/usr/bin/env bash
# Eine fertige OpenSpec-Change wird archiviert, BEVOR ihr PR gemergt wird (Entscheidung
# 30.09.2026). Wer die Archivierung auf „nach dem Merge“ verschiebt, braucht einen zweiten PR,
# und der blieb aus: am 30.09.2026 lagen zwölf umgesetzte Changes aktiv, ihre Delta-Specs nie in
# `openspec/specs/` übernommen.
#
# Rot ist eine aktive Change unter `openspec/changes/` (nicht `archive/`), deren `tasks.md`
# mindestens ein Kästchen und keines mehr offen hat. Erledigt ist ein Kästchen nur mit `x`/`X`
# (Leerraum in der Klammer egal); `[ ]`, `[]` und unbekannte Marken wie `[~]` gelten als offen,
# wie beim Archivieren selbst. Eine Change ohne `tasks.md` oder ohne Kästchen ist noch in Planung.
#
# Abhilfe: `/opsx:archive <name>` im selben Branch (Spec-Sync, Verschieben nach
# `openspec/changes/archive/<datum>-<name>/`, Verweise auf den alten Pfad nachziehen).
#
# Aufruf: scripts/check-openspec-archiv.sh [<repo-wurzel>]   (Selbsttest: *.test.sh daneben)
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
CHANGES="$ROOT/openspec/changes"
fertig=()

if [ -d "$CHANGES" ]; then
  for dir in "$CHANGES"/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    [ "$name" = archive ] && continue
    tasks="$dir/tasks.md"
    [ -f "$tasks" ] || continue
    gesamt="$(grep -cE '^[[:space:]]*- \[[^]]*\]' "$tasks" || true)"
    erledigt="$(grep -cE '^[[:space:]]*- \[[[:space:]]*[xX][[:space:]]*\]' "$tasks" || true)"
    if [ "$gesamt" -gt 0 ] && [ "$erledigt" -eq "$gesamt" ]; then
      fertig+=("$name")
    fi
  done
fi

if [ "${#fertig[@]}" -gt 0 ]; then
  echo "FEHLER: fertige OpenSpec-Changes liegen noch aktiv (alle Aufgaben erledigt):" >&2
  printf '         openspec/changes/%s/\n' "${fertig[@]}" >&2
  echo "       Vor dem Merge archivieren: /opsx:archive <name> im selben Branch" >&2
  echo "       (Spec-Sync, Verschieben nach openspec/changes/archive/<datum>-<name>/, Verweise nachziehen)." >&2
  exit 1
fi
echo "OK: keine fertige Change liegt aktiv."
