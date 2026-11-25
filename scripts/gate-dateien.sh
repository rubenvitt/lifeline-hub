#!/usr/bin/env bash
# Gate-Dateien im Diff (LLH-2090, scripts/AGENTS.md, „Gate-Dateien“): meldet, wenn ein Branch
# die Prüfungen ändert, die ihn bewerten — Gate-Skripte, ihre Selbsttests, Lint-Riegel,
# Playwright-Configs, Workflows, die Review-Prüfliste. Eine solche Änderung braucht einen
# Menschen: ein PR, der seine eigene Prüfung lockert, ist sonst grün.
#
#   scripts/gate-dateien.sh [<basis> [<kopf>]]     (Vorgabe: origin/alpha HEAD)
#
# Beobachten, nicht sperren: Exit 0 auch mit Treffern; Exit 2 nur, wenn ein Ref fehlt. In der
# CI liest `.github/workflows/migrationen.yml` dieses Skript vom ZIEL-Branch, damit ein PR die
# Liste unten nicht für sich selbst kürzen kann. Mit `GITHUB_STEP_SUMMARY` schreibt es dazu einen
# Abschnitt für die Zusammenfassung des Laufs; die Treffer stehen als `::warning` am PR.
# Selbsttest: scripts/gate-dateien.test.sh (Schritt 11 von scripts/check-all.sh).
set -euo pipefail

BASIS="${1:-origin/alpha}"
KOPF="${2:-HEAD}"
git() { command git -c core.quotePath=false "$@"; }

# Was als Gate-Datei gilt (Shell-Muster, `*` geht über `/`). Neue Prüfungen gehören hierher.
ist_gate_datei() {
  case "$1" in
    scripts/check-*.sh | scripts/*.test.sh | scripts/*.test.mjs | scripts/lib/* \
      | scripts/bereiche.sh | scripts/gate-dateien.sh | scripts/ruleset-pruefen.sh \
      | scripts/e2e-anteile.mjs | scripts/e2e-wackler.mjs) return 0 ;;
    .github/workflows/* | .github/pull_request_template.md) return 0 ;;
    frontend/playwright*.config.ts | frontend/vite.config.ts | frontend/.oxlintrc.json \
      | frontend/lint/*) return 0 ;;
    .claude/skills/dev-zunder-ausfuehren/references/review-pruefliste.md \
      | .claude/skills/verify/*) return 0 ;;
  esac
  return 1
}

commit_von() { # <ref> <rolle>
  git rev-parse --verify --quiet "$1^{commit}" || {
    echo "FEHLER: $2 '$1' ist kein Commit (fehlt ein 'git fetch'?)." >&2
    exit 2
  }
}
B="$(commit_von "$BASIS" Basis)"
K="$(commit_von "$KOPF" Kopf)"
M="$(git merge-base "$K" "$B")" || {
  echo "FEHLER: '$KOPF' und '$BASIS' haben keine gemeinsame Abzweigung." >&2
  exit 2
}

# Beide Namen einer Umbenennung zählen: der alte Name ist die Prüfung, die wegfällt.
treffer=()
while IFS=$'\t' read -r status alt neu; do
  for pfad in "$alt" ${neu:+"$neu"}; do
    if ist_gate_datei "$pfad"; then treffer+=("$pfad"); fi
  done
done < <(git diff --name-status -M "$M" "$K")

if [ "${#treffer[@]}" -eq 0 ]; then
  echo "==> Keine Gate-Datei geändert."
  exit 0
fi

# Ohne `mapfile`: das bash 3.2 von macOS kennt es nicht.
eindeutig=()
while IFS= read -r pfad; do eindeutig+=("$pfad"); done < <(printf '%s\n' "${treffer[@]}" | sort -u)
treffer=("${eindeutig[@]}")
echo "==> ${#treffer[@]} Gate-Dateien geändert — ein Mensch prüft, ob die Prüfung strenger oder lockerer wird:"
for pfad in "${treffer[@]}"; do
  echo "::warning file=$pfad::Gate-Datei geändert (LLH-2090): braucht die Durchsicht eines Menschen."
done
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Gate-Dateien"
    echo
    echo "${#treffer[@]} Gate-Dateien geändert. Ein Mensch prüft, ob die Prüfung strenger oder lockerer wird (scripts/AGENTS.md, „Gate-Dateien“)."
    echo
    printf -- '- `%s`\n' "${treffer[@]}"
  } >> "$GITHUB_STEP_SUMMARY"
fi
