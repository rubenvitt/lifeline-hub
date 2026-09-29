#!/usr/bin/env bash
# Node und pnpm aus EINER Quelle (LFH-773): `[tools]` in mise.toml. Skripte rufen
# `mise exec -- …`, die Workflows `jdx/mise-action` ohne `install_args` — beide lesen den Block
# selbst. Was die Zahl trotzdem tragen muss, weil ein anderes Werkzeug sie liest, prüft dieses
# Skript gegen den Block:
#
#   - `packageManager` in package.json und frontend/package.json (corepack, pnpm)
#   - `engines.node` in beiden package.json (pnpm prüft die Node-Version)
#   - die Node-Version des Devcontainers (.devcontainer/devcontainer.json)
#
# Und es bricht an jeder harten `node@<zahl>`/`pnpm@<zahl>` sowie an `actions/setup-node` in
# scripts/, .github/, README.md und .claude/skills/: dort entstand die Drift, die das Ticket
# vorfand (30 Kopien derselben Zahl, eine davon ohne Node-Pin).
#
# Aufruf: scripts/check-toolversionen.sh [<repo-wurzel>]   (Selbsttest: *.test.sh daneben)
set -euo pipefail

EIGENE_WURZEL="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="${1:-$EIGENE_WURZEL}"
fehler=0

melde() {
  echo "FEHLER: $1" >&2
  fehler=$((fehler + 1))
}

# Liest `<name> = "<wert>"` aus dem `[tools]`-Block von mise.toml — bewusst ohne mise, damit
# ein fehlender Block als solcher gemeldet wird.
tool_version() { # <name>
  awk -v name="$1" '
    /^\[/ { drin = ($0 == "[tools]"); next }
    drin {
      zeile = $0
      sub(/[[:space:]]*#.*/, "", zeile)
      if (zeile ~ "^[[:space:]]*" name "[[:space:]]*=") {
        sub(/^[^=]*=[[:space:]]*"/, "", zeile)
        sub(/".*$/, "", zeile)
        print zeile
        exit
      }
    }
  ' "$ROOT/mise.toml"
}

NODE="$(tool_version node)"
PNPM="$(tool_version pnpm)"
[ -n "$NODE" ] || melde "mise.toml: [tools] nennt keine Node-Version (node = \"…\")."
[ -n "$PNPM" ] || melde "mise.toml: [tools] nennt keine pnpm-Version (pnpm = \"…\")."
if [ "$fehler" -gt 0 ]; then
  exit 1
fi
echo "==> Quelle mise.toml [tools]: node $NODE, pnpm $PNPM"

# Liest einen Wert aus einer JSON-Datei (Pfadteile mit \x1f getrennt). Node über mise wie in
# den übrigen Skripten (jq ist keine Projektvoraussetzung) — und zwar das Node des Repos, in
# dem dieser Guard liegt, nicht das des geprüften Baums: dessen Zahl steht gerade in Frage.
json_wert() { # <datei> <pfad>
  mise -C "$EIGENE_WURZEL" exec -- node -e '
    const fs = require("node:fs");
    // devcontainer.json ist JSONC: Kommentare (nicht in Strings) und hängende Kommata raus.
    const text = fs.readFileSync(process.argv[1], "utf8")
      .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s) => s ?? "")
      .replace(/,(\s*[}\]])/g, "$1");
    let wert = JSON.parse(text);
    for (const teil of process.argv[2].split("\x1f")) wert = wert?.[teil];
    console.log(wert ?? "");
  ' "$1" "$2"
}

pruefe_gleich() { # <beschreibung> <soll> <ist>
  if [ "$2" = "$3" ]; then
    echo "    ok   $1 = $3"
  else
    melde "$1 ist '${3:-<fehlt>}', mise.toml sagt '$2'."
  fi
}

for paket in package.json frontend/package.json; do
  pruefe_gleich "$paket packageManager" "pnpm@$PNPM" "$(json_wert "$ROOT/$paket" packageManager)"
  pruefe_gleich "$paket engines.node" "$NODE" "$(json_wert "$ROOT/$paket" $'engines\x1fnode')"
done
pruefe_gleich ".devcontainer Node" "$NODE" \
  "$(json_wert "$ROOT/.devcontainer/devcontainer.json" $'features\x1fghcr.io/devcontainers/features/node:1\x1fversion')"

# Harte Zahlen. Der Guard und sein Selbsttest nennen die Muster selbst und sind ausgenommen.
suchorte=()
for ort in scripts .github README.md .claude/skills; do
  [ -e "$ROOT/$ort" ] && suchorte+=("$ROOT/$ort")
done
# Ohne Suchort kein grep: ein `grep -r` ohne Pfad durchsuchte still das aktuelle Verzeichnis.
treffer=""
[ ${#suchorte[@]} -gt 0 ] && treffer="$(grep -rnE '(^|[^[:alnum:]_/-])(node|pnpm)@[0-9]|actions/setup-node' "${suchorte[@]}" \
  --exclude=check-toolversionen.sh --exclude=check-toolversionen.test.sh 2>/dev/null || true)"
if [ -n "$treffer" ]; then
  melde "harte Node-/pnpm-Version außerhalb von mise.toml — stattdessen \`mise exec -- …\` bzw."
  echo "        \`jdx/mise-action\` ohne \`install_args\`:" >&2
  printf '%s\n' "$treffer" | sed "s|^$ROOT/|        - |" >&2
fi

if [ "$fehler" -gt 0 ]; then
  echo "==> $fehler Abweichung(en) von mise.toml [tools]." >&2
  exit 1
fi
echo "==> OK: Node und pnpm kommen überall aus mise.toml."
