#!/usr/bin/env bash
# Selbsttest für scripts/check-toolversionen.sh (LFH-773). Der Guard irrt in beide Richtungen
# still: ließe er eine harte Zahl durch, driftete die Node-Version wieder auseinander; schlüge
# er auf fremden Paketnamen an (`@types/node@…`), würde er abgeschaltet.
#
# Gefahren gegen einen Miniaturbaum im Temp-Verzeichnis, je Fall frisch aufgebaut.
set -euo pipefail

SKRIPT_UNTER_TEST="$(cd "$(dirname "$0")" && pwd)/check-toolversionen.sh"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
fehler=0

baum_neu() { # <name> → Pfad eines grünen Baums
  local b="$ARBEIT/$1"
  mkdir -p "$b/frontend" "$b/.devcontainer" "$b/scripts" "$b/.github/workflows" "$b/.claude/skills/x"
  printf '[tools]\nnode = "26.7.0"\npnpm = "11.10.0"\n\n[tasks.clean]\nrun = "true"\n' > "$b/mise.toml"
  for p in "$b/package.json" "$b/frontend/package.json"; do
    printf '{\n  "packageManager": "pnpm@11.10.0",\n  "engines": {\n    "node": "26.7.0"\n  }\n}\n' > "$p"
  done
  cat > "$b/.devcontainer/devcontainer.json" <<'JSON'
{
  // Kommentar mit "node:1" und // im Text
  "features": {
    "ghcr.io/devcontainers/features/node:1": {
      "version": "26.7.0", // nachgestellter Kommentar
    },
  },
}
JSON
  # Grün trotz ähnlicher Muster: fremde Pakete mit `node@`/`pnpm@` im Namen.
  printf 'mise exec -- pnpm install\nnpm install -g @cyclonedx/cdxgen@11.11.0\nnpm view @types/node@26\n' > "$b/scripts/bau.sh"
  printf 'steps:\n  - uses: jdx/mise-action@abc # v4\n    with:\n      version: 2026.9.1\n' > "$b/.github/workflows/ci.yml"
  printf 'mise exec -- pnpm -C frontend dev\n' > "$b/README.md"
  printf 'Frontend: `mise exec -- pnpm dev`\n' > "$b/.claude/skills/x/SKILL.md"
  (cd "$b" && mise trust -q mise.toml >/dev/null 2>&1 || true)
  printf '%s\n' "$b"
}

fall() { # <name> <erwartet: gruen|rot> <befehl, der den Baum $B verändert>
  local B
  B="$(baum_neu "$(printf '%s' "$1" | tr -c '[:alnum:]' '_')")"
  (cd "$B" && eval "$3")
  local ist=gruen
  # Aus $ARBEIT heraus: dort liegt der Köder des Falls „ohne Suchorte".
  (cd "$ARBEIT" && "$SKRIPT_UNTER_TEST" "$B") > "$ARBEIT/ausgabe" 2>&1 || ist=rot
  if [ "$ist" = "$2" ]; then
    echo "  ok   $1"
  else
    echo "  FEHL $1 — erwartet $2, gemessen $ist:" >&2
    sed 's/^/         /' "$ARBEIT/ausgabe" >&2
    fehler=$((fehler + 1))
  fi
}

echo "==> Selbsttest check-toolversionen.sh"
fall "grüner Baum (inkl. @types/node@, cdxgen@, JSONC)" gruen ":"
fall "harte Zahl in einem Skript" rot "echo 'mise exec node@26.7.0 -- node' >> scripts/bau.sh"
fall "harte pnpm-Zahl im README" rot "echo 'mise exec pnpm@11.10.0 -- pnpm dev' >> README.md"
fall "install_args mit Zahl im Workflow" rot "echo '      install_args: node@26.7.0 pnpm@11.10.0' >> .github/workflows/ci.yml"
fall "actions/setup-node im Workflow" rot "echo '  - uses: actions/setup-node@v5' >> .github/workflows/ci.yml"
fall "harte Zahl in einem Skill" rot "echo 'mise exec pnpm@11.10.0 -- pnpm dev' >> .claude/skills/x/SKILL.md"
fall "packageManager weicht ab" rot "sed -i.bak 's/pnpm@11.10.0/pnpm@11.9.0/' frontend/package.json"
fall "engines.node fehlt" rot "printf '{\"packageManager\": \"pnpm@11.10.0\"}\n' > package.json"
fall "Devcontainer gleitend auf 26" rot "sed -i.bak 's/\"26.7.0\"/\"26\"/' .devcontainer/devcontainer.json"
fall "mise.toml ohne [tools]" rot "printf '[tasks.clean]\nrun = \"true\"\n' > mise.toml"
fall "Node-Zahl in mise.toml gehoben, Rest nicht" rot "sed -i.bak 's/26.7.0/26.8.0/' mise.toml"
fall "ohne Suchorte kein grep im Arbeitsverzeichnis" gruen \
  "rm -rf scripts .github README.md .claude; echo 'mise exec node@26.7.0 -- node' > ../koeder.sh"

if [ "$fehler" -gt 0 ]; then
  echo "==> $fehler Fall/Fälle falsch." >&2
  exit 1
fi
echo "==> OK: der Guard trennt alle Fälle."
